import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError, ConflictError, ValidationError } from "../../errors/index.js";
import { toCamel } from "../../utils/mappers.js";
import { accTables, isIsoDate, list, round2, type Row } from "../../models/accounts/repo.js";
import { getSettings } from "./fiscal.service.js";
import { createVoucher, deleteVoucher } from "./vouchers.service.js";
import {
  BILLING_POINTS,
  chargeBillingPoint,
  loadTaxSetup,
  quoteTax,
  resolveBillingPoint,
  type BillingPointCode,
} from "./tax-resolver.js";
import { FO_SOURCE_MODULE, raiseFoCompanyBills } from "./fo-posting-markers.js";

// ---------------------------------------------------------------------------
// Pure builder: business facts in, balanced voucher lines out
// ---------------------------------------------------------------------------

export type FoTaxDetail = { taxCode: string; amount: number; outputAccountId?: string | null };

export type FoCharge = {
  id: string;
  chargeCategory: string;
  sourceType: string | null;
  amount: number;
  taxAmount: number;
  taxDetails: FoTaxDetail[];
  businessDate: string;
  /** "transaction": room charge raised by another module (room service, laundry); amount includes tax. */
  source?: "folio" | "transaction";
  /** Takes a charge back off the folio (room service reversal). */
  reversal?: boolean;
  /** Posted earlier and voided since: posted again the other way round. */
  voided?: boolean;
};

export type FoPayment = {
  id: string;
  transactionNumber: string;
  transactionType: string;
  paymentMethod: string;
  amount: number;
  /** RESERVATION = advance before check-in (held as a deposit); FRONT_OFFICE = paid against the folio. */
  sourceModule: string;
  /** Posted earlier and voided since: posted again the other way round. */
  voided?: boolean;
  /** The advance was already moved from deposits to the Guest Ledger at checkout. */
  adjusted?: boolean;
};

/** Posted advance of a guest who has now checked out: move it from deposits to the Guest Ledger. */
export type FoAdjustment = { id: string; transactionType: string; amount: number };

/** Balance left on a guest folio at checkout and billed to the company (Accounts party). */
export type FoCompanyBill = {
  id: string;
  billNo: string;
  partyId: string;
  partyName: string;
  receivableAccountId: string | null;
  amount: number;
  businessDate: string;
  /** Voided after it was posted: reverse the earlier transfer. */
  voided?: boolean;
};

export type FoLedgers = {
  guestLedgerId: string;
  guestDepositId: string;
  defaultReceivableId: string;
  incomeFor: (point: BillingPointCode, date: string) => { accountId: string; divisionId: string | null } | { issue: string };
  taxAccountFor: (detail: FoTaxDetail) => string;
  paymentAccountFor: (mode: string) => { accountId: string } | { issue: string };
  /** Split an amount that already includes tax, using the billing point's tax rules. */
  inclusiveTax: (point: BillingPointCode, gross: number, date: string) => { taxable: number; details: FoTaxDetail[] } | { issue: string };
};

export type FoPostingLine = {
  accountId: string;
  divisionId: string | null;
  partyId: string | null;
  entryType: "Dr" | "Cr";
  amount: number;
  narration: string;
};

export type FoPostingTotals = {
  charges: number;
  tax: number;
  payments: number;
  refunds: number;
  advances: number;
  adjusted: number;
  companyBills: number;
  voided: number;
};

export type FoPostingBuild = {
  lines: FoPostingLine[];
  issues: string[];
  /** folio_charges rows posted. */
  chargeIds: string[];
  /** transactions rows posted (payments, advances, room service / laundry charges). */
  paymentIds: string[];
  adjustmentIds: string[];
  voidIds: string[];
  companyBillIds: string[];
  /** Company bills voided after posting, reversed by this voucher. */
  companyBillVoidIds: string[];
  totals: FoPostingTotals;
};

const POINT_LABEL = new Map<string, string>(BILLING_POINTS.map((p) => [p.code, p.label]));

export function buildFoPosting(input: {
  charges: FoCharge[];
  payments: FoPayment[];
  adjustments: FoAdjustment[];
  companyBills?: FoCompanyBill[];
  ledgers: FoLedgers;
}): FoPostingBuild {
  const { ledgers } = input;
  const issues = new Set<string>();
  const groups = new Map<string, FoPostingLine>();
  const totals: FoPostingTotals = { charges: 0, tax: 0, payments: 0, refunds: 0, advances: 0, adjusted: 0, companyBills: 0, voided: 0 };
  const chargeIds: string[] = [];
  const paymentIds: string[] = [];
  const adjustmentIds: string[] = [];
  const voidIds: string[] = [];
  const companyBillIds: string[] = [];
  const companyBillVoidIds: string[] = [];

  const add = (
    accountId: string,
    entryType: "Dr" | "Cr",
    amount: number,
    narration: string,
    divisionId: string | null = null,
    partyId: string | null = null,
  ) => {
    const amt = round2(amount);
    if (!(amt > 0)) return;
    const key = `${accountId}|${divisionId ?? ""}|${partyId ?? ""}|${entryType}|${narration}`;
    const cur = groups.get(key);
    if (cur) cur.amount = round2(cur.amount + amt);
    else groups.set(key, { accountId, divisionId, partyId, entryType, amount: amt, narration });
  };
  const flip = (entryType: "Dr" | "Cr", reverse: boolean): "Dr" | "Cr" =>
    reverse ? (entryType === "Dr" ? "Cr" : "Dr") : entryType;

  const guestLedger = () => {
    if (!ledgers.guestLedgerId) {
      issues.add("Accounts → Company Settings → GL Defaults: select the Guest Ledger (in-house guests)");
    }
    return ledgers.guestLedgerId;
  };
  const guestDeposit = () => {
    if (!ledgers.guestDepositId) {
      issues.add("Accounts → Company Settings → GL Defaults: select the Guest Security Deposit ledger (advances)");
    }
    return ledgers.guestDepositId;
  };

  for (const c of input.charges) {
    const point = chargeBillingPoint(c.chargeCategory, c.sourceType);
    const label = POINT_LABEL.get(point) ?? point;
    let amount = round2(c.amount);
    let taxAmount = round2(c.taxAmount);
    let details = c.taxDetails.filter((d) => round2(d.amount) > 0);
    if (!(amount > 0) && !(taxAmount > 0)) continue;
    const income = ledgers.incomeFor(point, c.businessDate);
    if ("issue" in income) {
      issues.add(income.issue);
      continue;
    }
    if (c.source === "transaction") {
      const split = ledgers.inclusiveTax(point, amount, c.businessDate);
      if ("issue" in split) {
        issues.add(split.issue);
        continue;
      }
      details = split.details.filter((d) => round2(d.amount) > 0);
      taxAmount = round2(amount - split.taxable);
      amount = round2(split.taxable);
    }
    if (taxAmount > 0 && !details.length) {
      issues.add(`A ${label} on ${c.businessDate} has tax ₹${taxAmount} but no tax breakdown`);
      continue;
    }
    const taxAccounts = details.map((d) => ledgers.taxAccountFor(d));
    const missingTax = details.find((_, i) => !taxAccounts[i]);
    if (missingTax) {
      issues.add(`Accounts → Tax Master: ${missingTax.taxCode} has no output tax ledger`);
      continue;
    }
    // Tax lines carry the rounded split; the folio carries taxAmount. The last line absorbs any paisa difference.
    const taxShares = details.map((d) => round2(d.amount));
    if (taxShares.length) {
      const diff = round2(taxAmount - taxShares.reduce((s, v) => s + v, 0));
      taxShares[taxShares.length - 1] = round2(taxShares[taxShares.length - 1] + diff);
    }

    const ledger = guestLedger();
    if (!ledger) continue;
    const reverse = Boolean(c.reversal) !== Boolean(c.voided);
    const suffix = c.voided ? " (voided)" : reverse ? " (cancelled)" : "";
    add(ledger, flip("Dr", reverse), amount + taxAmount, `Guest folio charges${suffix}`);
    add(income.accountId, flip("Cr", reverse), amount, `${label}${suffix}`, income.divisionId);
    details.forEach((d, i) => add(taxAccounts[i], flip("Cr", reverse), taxShares[i], `${d.taxCode} on guest folio charges${suffix}`));
    if (c.voided) {
      totals.voided = round2(totals.voided + amount + taxAmount);
      voidIds.push(c.id);
    } else {
      const sign = reverse ? -1 : 1;
      totals.charges = round2(totals.charges + sign * amount);
      totals.tax = round2(totals.tax + sign * taxAmount);
      (c.source === "transaction" ? paymentIds : chargeIds).push(c.id);
    }
  }

  for (const p of input.payments) {
    const amount = round2(p.amount);
    if (!(amount > 0)) continue;
    const isRefund = p.transactionType === "REFUND";
    if (p.transactionType !== "PAYMENT" && !isRefund) continue;
    const bank = ledgers.paymentAccountFor(p.paymentMethod);
    if ("issue" in bank) {
      issues.add(bank.issue);
      continue;
    }
    const isAdvance = p.sourceModule === "RESERVATION";
    const holding = isAdvance && !p.adjusted ? guestDeposit() : guestLedger();
    if (!holding) continue;
    const mode = p.paymentMethod.replace(/_/g, " ").toLowerCase();
    const outflow = isRefund !== Boolean(p.voided);
    const prefix = p.voided ? "Voided: " : "";
    if (outflow) {
      add(holding, "Dr", amount, `${prefix}${isAdvance ? "Guest advances refunded" : "Refunds to guests"}`);
      add(bank.accountId, "Cr", amount, `${prefix}Front office refunds — ${mode}`);
    } else {
      add(bank.accountId, "Dr", amount, `${prefix}Front office collections — ${mode}`);
      add(holding, "Cr", amount, `${prefix}${isAdvance ? "Guest advances received" : "Payments received from guests"}`);
    }
    if (p.voided) {
      totals.voided = round2(totals.voided + amount);
      voidIds.push(p.id);
      continue;
    }
    if (isRefund) totals.refunds = round2(totals.refunds + amount);
    else if (isAdvance) totals.advances = round2(totals.advances + amount);
    else totals.payments = round2(totals.payments + amount);
    paymentIds.push(p.id);
  }

  for (const a of input.adjustments) {
    const amount = round2(a.amount);
    if (!(amount > 0)) continue;
    const deposit = guestDeposit();
    const ledger = guestLedger();
    if (!deposit || !ledger) continue;
    const refund = a.transactionType === "REFUND";
    add(refund ? ledger : deposit, "Dr", amount, "Advances adjusted at checkout");
    add(refund ? deposit : ledger, "Cr", amount, "Advances adjusted at checkout");
    totals.adjusted = round2(totals.adjusted + (refund ? -amount : amount));
    adjustmentIds.push(a.id);
  }

  for (const b of input.companyBills ?? []) {
    const amount = round2(b.amount);
    if (!(amount > 0)) continue;
    const receivable = b.receivableAccountId || ledgers.defaultReceivableId;
    if (!receivable) {
      issues.add(
        `Accounts → Party Master: ${b.partyName} has no receivable ledger (or set Company Settings → Default Receivable Account)`,
      );
      continue;
    }
    const ledger = guestLedger();
    if (!ledger) continue;
    if (b.voided) {
      add(ledger, "Dr", amount, "Voided company bills returned to guest ledger");
      add(receivable, "Cr", amount, `Voided bill to ${b.partyName} — ${b.billNo}`, null, b.partyId);
      totals.voided = round2(totals.voided + amount);
      companyBillVoidIds.push(b.id);
      continue;
    }
    add(receivable, "Dr", amount, `Billed to ${b.partyName} — ${b.billNo}`, null, b.partyId);
    add(ledger, "Cr", amount, "Guest bills transferred to companies");
    totals.companyBills = round2(totals.companyBills + amount);
    companyBillIds.push(b.id);
  }

  return {
    lines: [...groups.values()],
    issues: [...issues],
    chargeIds,
    paymentIds,
    adjustmentIds,
    voidIds,
    companyBillIds,
    companyBillVoidIds,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Loading from Front Office + Accounts
// ---------------------------------------------------------------------------

const SETUP_HINT = "Run backend/sql/accounts-fo-posting.sql and accounts-fo-posting-phase2.sql in Supabase.";

/** Room charges raised by other modules as transactions (amount includes tax). */
const MODULE_CHARGE_TYPES: Record<string, { chargeCategory: string; reversal: boolean }> = {
  ROOM_SERVICE: { chargeCategory: "FOOD_BEVERAGE", reversal: false },
  ROOM_SERVICE_REVERSAL: { chargeCategory: "FOOD_BEVERAGE", reversal: true },
  LAUNDRY: { chargeCategory: "LAUNDRY", reversal: false },
};

function pid(): string {
  const id = getActivePropertyId();
  if (!id) throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
  return id;
}

function dbError(error: { message: string }, what: string): never {
  if (/acc_voucher_id|acc_adjust_voucher_id|acc_void_voucher_id|business_date|fo_company_bills|schema cache|does not exist/i.test(error.message)) {
    throw new AppError(`Front Office posting is not set up (${what}). ${SETUP_HINT}`, 500, "SCHEMA_MISSING");
  }
  throw new AppError(`Could not read ${what}: ${error.message}`, 500);
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Start of a business date in hotel time (IST). */
export function startOfDay(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

/** End of a business date in hotel time (IST). */
export function endOfDay(date: string): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Calendar date in hotel time (IST) of a timestamp. */
export function istDate(ts: unknown): string {
  const d = new Date(String(ts ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function taxDetailsOf(raw: unknown): FoTaxDetail[] {
  return (Array.isArray(raw) ? (raw as Row[]) : []).map((d) => ({
    taxCode: String(d.taxCode ?? d.tax_code ?? ""),
    amount: num(d.amount),
    outputAccountId: d.outputAccountId ? String(d.outputAccountId) : null,
  }));
}

/** Folio charges up to a date. Charges without a business date use the day they were raised. */
async function loadCharges(date: string, start: string): Promise<{ charges: FoCharge[]; beforeStart: number }> {
  const { data, error } = await supabase
    .from("folio_charges")
    .select("id, charge_category, source_type, amount, tax_amount, tax_details, business_date, created_at")
    .eq("property_id", pid())
    .is("acc_voucher_id", null)
    .or(`business_date.lte.${date},and(business_date.is.null,created_at.lt.${endOfDay(date)})`);
  if (error) dbError(error, "folio charges");
  let beforeStart = 0;
  const charges: FoCharge[] = [];
  for (const r of (data ?? []) as Row[]) {
    const businessDate = r.business_date ? String(r.business_date).slice(0, 10) : istDate(r.created_at);
    if (start && businessDate < start) {
      beforeStart++;
      continue;
    }
    charges.push({
      id: String(r.id),
      chargeCategory: String(r.charge_category ?? "OTHER"),
      sourceType: r.source_type ? String(r.source_type) : null,
      amount: num(r.amount),
      taxAmount: num(r.tax_amount),
      taxDetails: taxDetailsOf(r.tax_details),
      businessDate,
      source: "folio",
    });
  }
  charges.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  return { charges, beforeStart };
}

function moduleChargeFrom(r: Row, voided = false): FoCharge | null {
  const kind = MODULE_CHARGE_TYPES[String(r.source_type ?? "")];
  if (!kind) return null;
  return {
    id: String(r.id),
    chargeCategory: kind.chargeCategory,
    sourceType: String(r.source_type),
    amount: num(r.amount),
    taxAmount: 0,
    taxDetails: [],
    businessDate: istDate(r.transaction_date),
    source: "transaction",
    reversal: kind.reversal,
    voided,
  };
}

/** Room service and laundry charged to the room (recorded by those modules as transactions). */
async function loadModuleCharges(date: string, start: string): Promise<FoCharge[]> {
  let q = supabase
    .from("transactions")
    .select("id, source_type, amount, transaction_date")
    .eq("property_id", pid())
    .is("acc_voucher_id", null)
    .eq("status", "COMPLETED")
    .eq("transaction_type", "ADJUSTMENT")
    .in("source_module", ["FNB", "HOUSEKEEPING"])
    .in("source_type", Object.keys(MODULE_CHARGE_TYPES))
    .lt("transaction_date", endOfDay(date));
  if (start) q = q.gte("transaction_date", startOfDay(start));
  const { data, error } = await q.order("transaction_date");
  if (error) dbError(error, "room service / laundry charges");
  return ((data ?? []) as Row[]).map((r) => moduleChargeFrom(r)).filter((c): c is FoCharge => !!c);
}

function paymentFrom(r: Row, voided = false): FoPayment {
  return {
    id: String(r.id),
    transactionNumber: String(r.transaction_number ?? ""),
    transactionType: String(r.transaction_type ?? "PAYMENT"),
    paymentMethod: String(r.payment_method ?? "OTHER"),
    amount: num(r.amount),
    sourceModule: String(r.source_module ?? ""),
    voided,
    adjusted: !!r.acc_adjust_voucher_id,
  };
}

async function loadPayments(cutoff: string, start: string): Promise<FoPayment[]> {
  let q = supabase
    .from("transactions")
    .select("id, transaction_number, transaction_type, payment_method, amount, source_module")
    .eq("property_id", pid())
    .is("acc_voucher_id", null)
    .eq("status", "COMPLETED")
    .in("source_module", ["FRONT_OFFICE", "RESERVATION"])
    .lt("transaction_date", cutoff);
  if (start) q = q.gte("transaction_date", startOfDay(start));
  const { data, error } = await q.order("transaction_date");
  if (error) dbError(error, "front office payments");
  return ((data ?? []) as Row[]).map((r) => paymentFrom(r));
}

/** Payments and room charges that were posted and have since been voided or failed. */
async function loadVoids(): Promise<{ charges: FoCharge[]; payments: FoPayment[] }> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, transaction_number, transaction_type, payment_method, amount, source_module, source_type, transaction_date, acc_adjust_voucher_id")
    .eq("property_id", pid())
    .not("acc_voucher_id", "is", null)
    .is("acc_void_voucher_id", null)
    .in("status", ["VOIDED", "FAILED"]);
  if (error) dbError(error, "voided transactions");
  const charges: FoCharge[] = [];
  const payments: FoPayment[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (r.transaction_type === "ADJUSTMENT") {
      const c = moduleChargeFrom(r, true);
      if (c) charges.push(c);
    } else {
      payments.push(paymentFrom(r, true));
    }
  }
  return { charges, payments };
}

/** Advances already posted to deposits whose reservation has checked out. */
async function loadAdjustments(): Promise<FoAdjustment[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, transaction_type, amount, booking_id")
    .eq("property_id", pid())
    .eq("source_module", "RESERVATION")
    .eq("status", "COMPLETED")
    .not("acc_voucher_id", "is", null)
    .is("acc_adjust_voucher_id", null)
    .not("booking_id", "is", null);
  if (error) dbError(error, "guest advances");
  const rows = (data ?? []) as Row[];
  if (!rows.length) return [];
  const bookingIds = [...new Set(rows.map((r) => String(r.booking_id)))];
  const { data: res, error: resErr } = await supabase
    .from("reservations")
    .select("id")
    .in("id", bookingIds)
    .eq("status", "CHECKED_OUT");
  if (resErr) throw new AppError(`Could not read reservations: ${resErr.message}`, 500);
  const out = new Set(((res ?? []) as Row[]).map((r) => String(r.id)));
  return rows
    .filter((r) => out.has(String(r.booking_id)))
    .map((r) => ({ id: String(r.id), transactionType: String(r.transaction_type ?? "PAYMENT"), amount: num(r.amount) }));
}

/** Checkout balances billed to companies, up to a date. */
async function loadCompanyBills(date: string, start: string): Promise<FoCompanyBill[]> {
  let q = supabase
    .from("fo_company_bills")
    .select("id, bill_no, party_id, amount, business_date")
    .eq("property_id", pid())
    .is("acc_voucher_id", null)
    .eq("status", "Open")
    .lte("business_date", date);
  if (start) q = q.gte("business_date", start);
  const { data, error } = await q.order("business_date");
  if (error) dbError(error, "company bills");
  // Voided after posting (any date): reverse. Needs phase 3; skipped until it is run.
  const voided = await supabase
    .from("fo_company_bills")
    .select("id, bill_no, party_id, amount, business_date")
    .eq("property_id", pid())
    .eq("status", "Void")
    .not("acc_voucher_id", "is", null)
    .is("acc_void_voucher_id", null);
  if (voided.error && !/acc_void_voucher_id/i.test(voided.error.message)) dbError(voided.error, "voided company bills");
  const voidIds = new Set(((voided.data ?? []) as Row[]).map((r) => String(r.id)));
  const rows = [...((data ?? []) as Row[]), ...((voided.data ?? []) as Row[])];
  if (!rows.length) return [];
  const parties = await list(accTables.parties, {
    in: { id: [...new Set(rows.map((r) => String(r.party_id)))] },
    select: "id,party_name,receivable_account_id",
  });
  const byId = new Map(parties.map((p) => [p.id as string, p]));
  return rows.map((r) => {
    const p = byId.get(String(r.party_id));
    return {
      id: String(r.id),
      billNo: String(r.bill_no),
      partyId: String(r.party_id),
      partyName: String(p?.partyName ?? "company"),
      receivableAccountId: p?.receivableAccountId ? String(p.receivableAccountId) : null,
      amount: num(r.amount),
      businessDate: String(r.business_date).slice(0, 10),
      voided: voidIds.has(String(r.id)),
    };
  });
}

export async function loadLedgers(): Promise<{
  ledgers: FoLedgers;
  settings: Row | null;
  setup: Awaited<ReturnType<typeof loadTaxSetup>>;
}> {
  const [settings, setup, methods] = await Promise.all([
    getSettings(),
    loadTaxSetup(),
    list(accTables.paymentMethods),
  ]);
  if (settings && !("defaultGuestLedgerAccountId" in settings)) {
    throw new AppError(`Front Office posting is not set up (company settings). ${SETUP_HINT}`, 500, "SCHEMA_MISSING");
  }
  const taxByCode = new Map([...setup.taxes.values()].map((t) => [t.code, t.outputAccountId]));

  const ledgers: FoLedgers = {
    guestLedgerId: String(settings?.defaultGuestLedgerAccountId ?? ""),
    guestDepositId: String(settings?.defaultGuestDepositAccountId ?? ""),
    defaultReceivableId: String(settings?.defaultReceivableAccountId ?? ""),
    incomeFor: (point, date) => {
      const label = POINT_LABEL.get(point) ?? point;
      const r = resolveBillingPoint(setup, point, date);
      if (!r.configured || !r.categoryId) {
        return { issue: `Accounts → Tax/GST Master → Billing Points: map "${label}" to a revenue category` };
      }
      if (!r.incomeAccountId) {
        return { issue: `Accounts → Revenue Category Master: ${r.categoryName} has no income ledger` };
      }
      return { accountId: r.incomeAccountId, divisionId: r.divisionId || null };
    },
    taxAccountFor: (d) => d.outputAccountId || taxByCode.get(d.taxCode) || "",
    paymentAccountFor: (mode) => {
      const label = mode.replace(/_/g, " ");
      const method = methods.find((m) => m.foPaymentMode === mode && m.status === "Active");
      if (!method) {
        return { issue: `Accounts → Payment Method Master: set Front Office payment mode "${label}" on a payment method` };
      }
      if (!method.accountId) {
        return { issue: `Accounts → Payment Method Master: ${method.paymentMethodName} has no ledger` };
      }
      return { accountId: String(method.accountId) };
    },
    inclusiveTax: (point, gross, date) => {
      const r = resolveBillingPoint(setup, point, date);
      if (!r.configured) return { taxable: gross, details: [] };
      const q = quoteTax(r.ruleset, gross, date, { priceIncludesTax: true });
      if (!q.ok) return { issue: `${POINT_LABEL.get(point) ?? point}: ${q.issue}` };
      return {
        taxable: q.taxableAmount,
        details: q.lines.map((l) => ({ taxCode: l.taxCode, amount: l.amount, outputAccountId: l.outputAccountId })),
      };
    },
  };
  return { ledgers, settings, setup };
}

async function build(date: string, cutoff: string) {
  const { ledgers, settings } = await loadLedgers();
  const start = settings?.foPostingStartDate ? String(settings.foPostingStartDate).slice(0, 10) : "";
  const [{ charges, beforeStart }, moduleCharges, payments, voids, adjustments, companyBills] = await Promise.all([
    loadCharges(date, start),
    loadModuleCharges(date, start),
    loadPayments(cutoff, start),
    loadVoids(),
    loadAdjustments(),
    loadCompanyBills(date, start),
  ]);
  const result = buildFoPosting({
    charges: [...charges, ...moduleCharges, ...voids.charges],
    payments: [...payments, ...voids.payments],
    adjustments,
    companyBills,
    ledgers,
  });
  return { result, beforeStart, start, settings };
}

export type MarkTarget = { table: "folio_charges" | "transactions" | "fo_company_bills" | "fb_bills"; column: string; ids: string[] };

export async function markPosted({ table, column, ids }: MarkTarget, voucherId: string) {
  if (!ids.length) return 0;
  let marked = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from(table)
      .update({ [column]: voucherId })
      .eq("property_id", pid())
      .in("id", ids.slice(i, i + 200))
      .is(column, null)
      .select("id");
    if (error) throw new AppError(`Could not mark ${table} as posted: ${error.message}`, 500);
    marked += (data ?? []).length;
  }
  return marked;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function requireDate(date: unknown): string {
  if (!isIsoDate(date)) throw new ValidationError("Business date (YYYY-MM-DD) is required");
  return date;
}

function counts(result: FoPostingBuild) {
  return {
    charges: result.chargeIds.length,
    payments: result.paymentIds.length,
    adjustments: result.adjustmentIds.length,
    companyBills: result.companyBillIds.length,
    voided: result.voidIds.length + result.companyBillVoidIds.length,
  };
}

export const FoPostingService = {
  /** What would be posted for a business date, with ledger names and any setup problems. */
  async preview(dateInput: unknown) {
    const date = requireDate(dateInput);
    const { result, beforeStart, start, settings } = await build(date, endOfDay(date));
    const [accounts, divisions, parties] = await Promise.all([
      list(accTables.accounts, { select: "id,code,name,status,account_type,allow_posting" }),
      list(accTables.divisions, { select: "id,division_name" }),
      list(accTables.parties, { select: "id,party_name" }),
    ]);
    const accById = new Map(accounts.map((a) => [a.id as string, a]));
    const divById = new Map(divisions.map((d) => [d.id as string, d.divisionName as string]));
    const partyById = new Map(parties.map((p) => [p.id as string, p.partyName as string]));
    const issues = [...result.issues];
    for (const l of result.lines) {
      const acc = accById.get(l.accountId);
      if (!acc) issues.push(`A mapped ledger no longer exists (${l.narration})`);
      else if (acc.accountType !== "Ledger" || !acc.allowPosting) issues.push(`${acc.name} is a group account — map a ledger (${l.narration})`);
      else if (acc.status !== "Active") issues.push(`${acc.name} is inactive (${l.narration})`);
    }
    const debit = round2(result.lines.reduce((s, l) => s + (l.entryType === "Dr" ? l.amount : 0), 0));
    const credit = round2(result.lines.reduce((s, l) => s + (l.entryType === "Cr" ? l.amount : 0), 0));
    return {
      businessDate: date,
      postingStatus: String(settings?.foPostingStatus ?? "Draft"),
      startDate: start || null,
      lines: result.lines.map((l) => ({
        ...l,
        accountCode: accById.get(l.accountId)?.code ?? null,
        accountName: accById.get(l.accountId)?.name ?? null,
        divisionName: l.divisionId ? divById.get(l.divisionId) ?? null : null,
        partyName: l.partyId ? partyById.get(l.partyId) ?? null : null,
      })),
      issues: [...new Set(issues)],
      counts: { ...counts(result), beforeStart },
      totals: { ...result.totals, debit, credit },
      canPost: issues.length === 0 && result.lines.length > 0,
    };
  },

  /**
   * Post everything unposted up to a business date as one Journal Voucher.
   * Draft or Posted per Company Settings. Nothing is posted when any mapping is missing.
   */
  async post(dateInput: unknown, opts: { cutoff?: string; trigger?: "NIGHT_AUDIT" | "MANUAL" } = {}) {
    const date = requireDate(dateInput);
    const { result, settings } = await build(date, opts.cutoff ?? endOfDay(date));
    if (result.issues.length) {
      throw new ValidationError(`Cannot post Front Office ${date} to Accounts — ${result.issues.join("; ")}`);
    }
    if (!result.lines.length) {
      return { businessDate: date, voucher: null, totals: result.totals, counts: counts({ ...result, chargeIds: [], paymentIds: [], adjustmentIds: [], voidIds: [], companyBillIds: [], companyBillVoidIds: [] }) };
    }

    const status = settings?.foPostingStatus === "Posted" ? "Posted" : "Draft";
    const voucher = await createVoucher({
      voucherTypeCode: "JV",
      voucherDate: date,
      referenceNo: `FO-${date}`,
      narration: `Front Office ${opts.trigger === "NIGHT_AUDIT" ? "Night Audit" : "posting"} — business date ${date}`,
      status,
      sourceModule: FO_SOURCE_MODULE,
      sourceType: opts.trigger ?? "MANUAL",
      sourceRef: `FO:${date}`,
      businessDate: date,
      lines: result.lines.map((l) => ({
        accountId: l.accountId,
        divisionId: l.divisionId,
        partyId: l.partyId,
        entryType: l.entryType,
        amount: l.amount,
        narration: l.narration,
      })),
    });

    const targets: MarkTarget[] = [
      { table: "folio_charges", column: "acc_voucher_id", ids: result.chargeIds },
      { table: "transactions", column: "acc_voucher_id", ids: result.paymentIds },
      { table: "transactions", column: "acc_adjust_voucher_id", ids: result.adjustmentIds },
      { table: "transactions", column: "acc_void_voucher_id", ids: result.voidIds },
      { table: "fo_company_bills", column: "acc_voucher_id", ids: result.companyBillIds },
      { table: "fo_company_bills", column: "acc_void_voucher_id", ids: result.companyBillVoidIds },
    ];
    const marked = await Promise.all(targets.map((t) => markPosted(t, voucher.id)));
    if (marked.some((n, i) => n !== targets[i].ids.length)) {
      // Another run posted some of these rows at the same time; undo this voucher.
      if (status === "Draft") await deleteVoucher(voucher.id);
      throw new ConflictError("Front Office posting ran twice at the same time — refresh and check the vouchers");
    }
    if (status === "Posted") await raiseFoCompanyBills(voucher);
    return {
      businessDate: date,
      voucher: { id: voucher.id, voucherNo: voucher.voucherNo, status: voucher.status, totalAmount: voucher.totalAmount },
      totals: result.totals,
      counts: counts(result),
    };
  },

  /** Front Office vouchers, newest first. */
  async history(limit = 30) {
    const { data, error } = await supabase
      .from(accTables.vouchers)
      .select("id, voucher_no, voucher_date, business_date, status, total_amount, source_type, narration, created_at")
      .eq("property_id", pid())
      .eq("source_module", FO_SOURCE_MODULE)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) dbError(error, "Front Office vouchers");
    return toCamel<Row[]>(data ?? []).map((v) => ({ ...v, totalAmount: num(v.totalAmount) }));
  },
};

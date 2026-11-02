import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError, ConflictError, ValidationError } from "../../errors/index.js";
import { toCamel } from "../../utils/mappers.js";
import { accTables, isIsoDate, list, round2, type Row } from "../../models/accounts/repo.js";
import { createVoucher, deleteVoucher } from "./vouchers.service.js";
import { BILLING_POINTS, quoteTax, resolveBillingPoint, type BillingPointCode } from "./tax-resolver.js";
import {
  endOfDay,
  istDate,
  loadLedgers,
  markPostedBatch,
  type FoLedgers,
  type FoPostingLine,
  type FoTaxDetail,
  type MarkTarget,
} from "./fo-posting.service.js";
import { FB_SOURCE_MODULE } from "./fo-posting-markers.js";
import { fnbTransactionOutlets, storedOutlets } from "./outlet-posting-rules.js";

// ---------------------------------------------------------------------------
// Pure builder: settled POS bills and their payments in, balanced voucher lines out
// ---------------------------------------------------------------------------

export type FbPayment = {
  id: string;
  paymentMethod: string;
  amount: number;
  /** Posted earlier and voided since: taken back out of the payment ledger. */
  voided?: boolean;
  outletId?: string | null;
};

/** A fully paid POS bill (not charged to a room). */
export type FbBill = {
  id: string;
  billNo: string;
  billingPoint: BillingPointCode;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  businessDate: string;
  payments: FbPayment[];
  outletId?: string | null;
};

export type FbLedgers = Pick<
  FoLedgers,
  "guestLedgerId" | "incomeFor" | "taxAccountFor" | "paymentAccountFor" | "outletDivision" | "outletName"
> & {
  /** Split a bill's tax across tax codes using the billing point's rules. */
  taxSplit: (point: BillingPointCode, taxable: number, date: string) => { details: FoTaxDetail[] } | { issue: string };
};

export type FbPostingTotals = { sales: number; tax: number; discount: number; collections: number; voided: number };

export type FbOutletTotals = FbPostingTotals & {
  outletId: string | null;
  outletName: string;
  divisionId: string | null;
  bills: number;
};

export type FbPostingBuild = {
  lines: FoPostingLine[];
  issues: string[];
  /** Do not block posting (e.g. an outlet with no Accounts division). */
  warnings: string[];
  billIds: string[];
  /** Payments posted (with their bill, or later on an already-posted bill). */
  paymentIds: string[];
  voidIds: string[];
  totals: FbPostingTotals;
  byOutlet: FbOutletTotals[];
};

const POINT_LABEL = new Map<string, string>(BILLING_POINTS.map((p) => [p.code, p.label]));

export function buildFbPosting(input: {
  bills: FbBill[];
  /** Payments on bills already posted (e.g. collected again after a void). */
  latePayments: FbPayment[];
  /** Posted payments voided since. */
  voids: FbPayment[];
  ledgers: FbLedgers;
}): FbPostingBuild {
  const { ledgers } = input;
  const issues = new Set<string>();
  const warnings = new Set<string>();
  const groups = new Map<string, FoPostingLine>();
  const totals: FbPostingTotals = { sales: 0, tax: 0, discount: 0, collections: 0, voided: 0 };
  const billIds: string[] = [];
  const paymentIds: string[] = [];
  const voidIds: string[] = [];
  const outlets = new Map<string, FbOutletTotals>();

  const outletName = (id: string | null | undefined) => (id ? ledgers.outletName?.(id) ?? id : "No outlet");
  /** " — Lounge Bar" on narrations, so each outlet keeps its own voucher lines. */
  const at = (id: string | null | undefined) => (id ? ` — ${outletName(id)}` : "");
  const outletTotals = (id: string | null | undefined, divisionId: string | null) => {
    const key = id ?? "";
    let t = outlets.get(key);
    if (!t) {
      t = { outletId: id ?? null, outletName: outletName(id), divisionId, bills: 0, sales: 0, tax: 0, discount: 0, collections: 0, voided: 0 };
      outlets.set(key, t);
    }
    if (!t.divisionId && divisionId) t.divisionId = divisionId;
    return t;
  };
  const checkDivision = (id: string | null | undefined, point?: BillingPointCode) => {
    if (id && ledgers.outletDivision && !ledgers.outletDivision(id, point)) {
      warnings.add(
        `${outletName(id)} has no Accounts division — map one on F&B Posting → Outlet posting rules to report it as its own revenue centre`,
      );
    }
  };

  const add = (accountId: string, entryType: "Dr" | "Cr", amount: number, narration: string, divisionId: string | null = null) => {
    const amt = round2(amount);
    if (!(amt > 0)) return;
    const key = `${accountId}|${divisionId ?? ""}|${entryType}|${narration}`;
    const cur = groups.get(key);
    if (cur) cur.amount = round2(cur.amount + amt);
    else groups.set(key, { accountId, divisionId, partyId: null, entryType, amount: amt, narration });
  };
  const guestLedger = () => {
    if (!ledgers.guestLedgerId) {
      issues.add("Accounts → Company Settings → GL Defaults: select the Guest Ledger (F&B bills paid short or voided)");
    }
    return ledgers.guestLedgerId;
  };
  const modeLabel = (mode: string) => mode.replace(/_/g, " ").toLowerCase();

  for (const b of input.bills) {
    const label = POINT_LABEL.get(b.billingPoint) ?? b.billingPoint;
    const net = round2(b.subtotal - b.discount);
    const tax = round2(b.tax);
    const total = round2(net + tax);
    if (!(total > 0)) continue;

    const income = ledgers.incomeFor(b.billingPoint, b.businessDate, b.outletId);
    if ("issue" in income) {
      issues.add(income.issue);
      continue;
    }
    const where = at(b.outletId);
    const division = income.divisionId;
    let details: FoTaxDetail[] = [];
    let shares: number[] = [];
    if (tax > 0) {
      const split = ledgers.taxSplit(b.billingPoint, b.subtotal, b.businessDate);
      if ("issue" in split) {
        issues.add(split.issue);
        continue;
      }
      details = split.details.filter((d) => round2(d.amount) > 0);
      const base = details.reduce((s, d) => s + d.amount, 0);
      if (!details.length || !(base > 0)) {
        issues.add(`${label}: bill ${b.billNo} has tax ₹${tax} but the billing point has no tax rules for ${b.businessDate}`);
        continue;
      }
      // The bill carries the tax total; split it in the rules' proportions, last line takes the paisa difference.
      shares = details.map((d) => round2((tax * d.amount) / base));
      shares[shares.length - 1] = round2(shares[shares.length - 1] + tax - shares.reduce((s, v) => s + v, 0));
    }
    const taxAccounts = details.map((d) => ledgers.taxAccountFor(d));
    const missingTax = details.find((_, i) => !taxAccounts[i]);
    if (missingTax) {
      issues.add(`Accounts → Tax Master: ${missingTax.taxCode} has no output tax ledger`);
      continue;
    }
    const banks = b.payments.map((p) => ({ p, bank: ledgers.paymentAccountFor(p.paymentMethod, b.outletId, b.billingPoint) }));
    const badBank = banks.find((x) => "issue" in x.bank);
    if (badBank && "issue" in badBank.bank) {
      issues.add(badBank.bank.issue);
      continue;
    }
    const paid = round2(b.payments.reduce((s, p) => s + p.amount, 0));
    const diff = round2(paid - total);
    if (diff !== 0 && !guestLedger()) continue;

    for (const { p, bank } of banks) {
      if ("accountId" in bank) add(bank.accountId, "Dr", p.amount, `F&B collections — ${modeLabel(p.paymentMethod)}${where}`, division);
    }
    add(income.accountId, "Cr", net, `${label}${where}`, division);
    details.forEach((d, i) => add(taxAccounts[i], "Cr", shares[i], `${d.taxCode} on F&B bills${where}`, division));
    if (diff > 0) add(ledgers.guestLedgerId, "Cr", diff, `F&B bills paid in excess${where}`, division);
    if (diff < 0) add(ledgers.guestLedgerId, "Dr", -diff, `F&B bills paid short${where}`, division);

    checkDivision(b.outletId, b.billingPoint);
    const o = outletTotals(b.outletId, division);
    o.bills += 1;
    o.sales = round2(o.sales + net);
    o.tax = round2(o.tax + tax);
    o.discount = round2(o.discount + b.discount);
    o.collections = round2(o.collections + paid);
    totals.sales = round2(totals.sales + net);
    totals.tax = round2(totals.tax + tax);
    totals.discount = round2(totals.discount + b.discount);
    totals.collections = round2(totals.collections + paid);
    billIds.push(b.id);
    paymentIds.push(...b.payments.map((p) => p.id));
  }

  for (const p of [...input.latePayments, ...input.voids]) {
    const amount = round2(p.amount);
    if (!(amount > 0)) continue;
    const bank = ledgers.paymentAccountFor(p.paymentMethod, p.outletId);
    if ("issue" in bank) {
      issues.add(bank.issue);
      continue;
    }
    const ledger = guestLedger();
    if (!ledger) continue;
    const where = at(p.outletId);
    const division = ledgers.outletDivision?.(p.outletId) ?? null;
    const o = outletTotals(p.outletId, division);
    if (p.voided) {
      add(ledger, "Dr", amount, `Voided F&B payments${where}`, division);
      add(bank.accountId, "Cr", amount, `Voided: F&B collections — ${modeLabel(p.paymentMethod)}${where}`, division);
      o.voided = round2(o.voided + amount);
      totals.voided = round2(totals.voided + amount);
      voidIds.push(p.id);
    } else {
      add(bank.accountId, "Dr", amount, `F&B collections — ${modeLabel(p.paymentMethod)}${where}`, division);
      add(ledger, "Cr", amount, `F&B bills collected after posting${where}`, division);
      o.collections = round2(o.collections + amount);
      totals.collections = round2(totals.collections + amount);
      paymentIds.push(p.id);
    }
  }

  const byOutlet = [...outlets.values()].sort((a, b) => a.outletName.localeCompare(b.outletName));
  return { lines: [...groups.values()], issues: [...issues], warnings: [...warnings], billIds, paymentIds, voidIds, totals, byOutlet };
}

// ---------------------------------------------------------------------------
// Loading from the POS + Accounts
// ---------------------------------------------------------------------------

const SETUP_HINT = "Run backend/sql/accounts-fo-posting.sql, accounts-fo-posting-phase2.sql and accounts-fb-posting.sql in Supabase.";

function pid(): string {
  const id = getActivePropertyId();
  if (!id) throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
  return id;
}

function dbError(error: { message: string }, what: string): never {
  if (/acc_voucher_id|acc_void_voucher_id|schema cache|does not exist/i.test(error.message)) {
    throw new AppError(`F&B posting is not set up (${what}). ${SETUP_HINT}`, 500, "SCHEMA_MISSING");
  }
  throw new AppError(`Could not read ${what}: ${error.message}`, 500);
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const isRoomCharge = (mode: unknown) => /room\s*charge/i.test(String(mode ?? ""));

async function selectIn(table: string, select: string, column: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(table).select(select).in(column, ids.slice(i, i + 200));
    if (error) dbError(error, table);
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out;
}

function paymentFrom(r: Row, voided = false): FbPayment {
  return { id: String(r.id), paymentMethod: String(r.payment_method ?? "OTHER"), amount: num(r.amount), voided };
}

/** Fully paid, unposted POS bills (room-charge bills are posted by Front Office) paid up to a date. */
async function loadBills(date: string, start: string): Promise<{ bills: FbBill[]; beforeStart: number }> {
  const { data, error } = await supabase
    .from("fb_bills")
    .select("id, bill_no, order_id, subtotal, tax, discount, total")
    .eq("property_id", pid())
    .eq("payment_status", "PAID")
    .is("acc_voucher_id", null);
  if (error) dbError(error, "F&B bills");
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { bills: [], beforeStart: 0 };

  const [orders, txns, billOutlets] = await Promise.all([
    selectIn("fb_orders", "id, type, payment_mode, outlet_id", "id", [...new Set(rows.map((r) => String(r.order_id)))]),
    selectIn("transactions", "id, source_id, payment_method, amount, status, transaction_type, transaction_date, acc_voucher_id, source_module", "source_id", rows.map((r) => String(r.id))),
    storedOutlets("fb_bills", rows.map((r) => String(r.id))),
  ]);
  const orderById = new Map(orders.map((o) => [String(o.id), o]));
  const paysByBill = new Map<string, Row[]>();
  for (const t of txns) {
    if (t.source_module !== "FNB" || t.transaction_type !== "PAYMENT" || t.status !== "COMPLETED" || t.acc_voucher_id) continue;
    const arr = paysByBill.get(String(t.source_id)) ?? [];
    arr.push(t);
    paysByBill.set(String(t.source_id), arr);
  }

  let beforeStart = 0;
  const bills: FbBill[] = [];
  for (const r of rows) {
    const order = orderById.get(String(r.order_id));
    if (isRoomCharge(order?.payment_mode)) continue;
    const pays = paysByBill.get(String(r.id)) ?? [];
    if (!pays.length) continue;
    const paidAt = pays.map((p) => String(p.transaction_date ?? "")).sort().pop() ?? "";
    if (paidAt >= endOfDay(date)) continue;
    const businessDate = istDate(paidAt);
    if (start && businessDate < start) {
      beforeStart++;
      continue;
    }
    const outletId = billOutlets.get(String(r.id)) ?? (order?.outlet_id ? String(order.outlet_id) : null);
    bills.push({
      id: String(r.id),
      outletId,
      billNo: String(r.bill_no ?? r.id),
      billingPoint: String(order?.type ?? "").trim() === "Room Service" ? "FB_ROOM_SERVICE" : "FB_RESTAURANT_BILL",
      subtotal: num(r.subtotal),
      discount: num(r.discount),
      tax: num(r.tax),
      total: num(r.total),
      businessDate,
      payments: pays.map((p) => ({ ...paymentFrom(p), outletId })),
    });
  }
  bills.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  return { bills, beforeStart };
}

/** F&B payments on bills already posted, and posted F&B payments voided since. */
async function loadLateAndVoided(date: string): Promise<{ latePayments: FbPayment[]; voids: FbPayment[] }> {
  const [late, voided] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, source_id, payment_method, amount")
      .eq("property_id", pid())
      .eq("source_module", "FNB")
      .eq("transaction_type", "PAYMENT")
      .eq("status", "COMPLETED")
      .is("acc_voucher_id", null)
      .lt("transaction_date", endOfDay(date)),
    supabase
      .from("transactions")
      .select("id, source_id, payment_method, amount")
      .eq("property_id", pid())
      .eq("source_module", "FNB")
      .eq("transaction_type", "PAYMENT")
      .eq("status", "VOIDED")
      .not("acc_voucher_id", "is", null)
      .is("acc_void_voucher_id", null),
  ]);
  if (late.error) dbError(late.error, "F&B payments");
  if (voided.error) dbError(voided.error, "voided F&B payments");
  const lateRows = (late.data ?? []) as Row[];
  const billIds = [...new Set(lateRows.map((r) => String(r.source_id ?? "")).filter(Boolean))];
  const postedBills = billIds.length
    ? new Set(
        (await selectIn("fb_bills", "id, acc_voucher_id", "id", billIds))
          .filter((b) => b.acc_voucher_id)
          .map((b) => String(b.id)),
      )
    : new Set<string>();
  const lateOnPosted = lateRows.filter((r) => postedBills.has(String(r.source_id)));
  const voidRows = (voided.data ?? []) as Row[];
  const outlets = await fnbTransactionOutlets(
    [...lateOnPosted, ...voidRows].map((r) => ({ id: String(r.id), sourceId: String(r.source_id ?? "") })),
  );
  const withOutlet = (p: FbPayment): FbPayment => ({ ...p, outletId: outlets.get(p.id) ?? null });
  return {
    latePayments: lateOnPosted.map((r) => withOutlet(paymentFrom(r))),
    voids: voidRows.map((r) => withOutlet(paymentFrom(r, true))),
  };
}

async function build(date: string) {
  const { ledgers, settings, setup } = await loadLedgers();
  const start = settings?.foPostingStartDate ? String(settings.foPostingStartDate).slice(0, 10) : "";
  const fbLedgers: FbLedgers = {
    ...ledgers,
    taxSplit: (point, taxable, d) => {
      const r = resolveBillingPoint(setup, point, d);
      if (!r.configured) return { issue: `Accounts → Tax/GST Master → Billing Points: map "${POINT_LABEL.get(point) ?? point}" to a revenue category` };
      const q = quoteTax(r.ruleset, taxable, d, { priceIncludesTax: false });
      if (!q.ok) return { issue: `${POINT_LABEL.get(point) ?? point}: ${q.issue}` };
      return { details: q.lines.map((l) => ({ taxCode: l.taxCode, amount: l.amount, outputAccountId: l.outputAccountId })) };
    },
  };
  const [{ bills, beforeStart }, { latePayments, voids }] = await Promise.all([loadBills(date, start), loadLateAndVoided(date)]);
  const result = buildFbPosting({ bills, latePayments, voids, ledgers: fbLedgers });
  return { result, beforeStart, start, settings };
}

function requireDate(date: unknown): string {
  if (!isIsoDate(date)) throw new ValidationError("Business date (YYYY-MM-DD) is required");
  return date;
}

function counts(result: FbPostingBuild) {
  return { bills: result.billIds.length, payments: result.paymentIds.length, voided: result.voidIds.length };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const FbPostingService = {
  /** What would be posted for a business date, with ledger names and any setup problems. */
  async preview(dateInput: unknown) {
    const date = requireDate(dateInput);
    const { result, beforeStart, start, settings } = await build(date);
    const [accounts, divisions] = await Promise.all([
      list(accTables.accounts, { select: "id,code,name,status,account_type,allow_posting" }),
      list(accTables.divisions, { select: "id,division_name" }),
    ]);
    const accById = new Map(accounts.map((a) => [a.id as string, a]));
    const divById = new Map(divisions.map((d) => [d.id as string, d.divisionName as string]));
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
        partyName: null,
      })),
      issues: [...new Set(issues)],
      warnings: result.warnings,
      byOutlet: result.byOutlet.map((o) => ({
        ...o,
        divisionName: o.divisionId ? divById.get(o.divisionId) ?? null : null,
      })),
      counts: { ...counts(result), beforeStart },
      totals: { ...result.totals, debit, credit },
      canPost: issues.length === 0 && result.lines.length > 0,
    };
  },

  /** Post every settled, unposted POS bill up to a business date as one Journal Voucher. */
  async post(dateInput: unknown, opts: { trigger?: "NIGHT_AUDIT" | "MANUAL" } = {}) {
    const date = requireDate(dateInput);
    const { result, settings } = await build(date);
    if (result.issues.length) {
      throw new ValidationError(`Cannot post F&B ${date} to Accounts — ${result.issues.join("; ")}`);
    }
    if (!result.lines.length) {
      return { businessDate: date, voucher: null, totals: result.totals, counts: { bills: 0, payments: 0, voided: 0 } };
    }

    const status = settings?.foPostingStatus === "Posted" ? "Posted" : "Draft";
    const voucher = await createVoucher({
      voucherTypeCode: "JV",
      voucherDate: date,
      referenceNo: `FB-${date}`,
      narration: `F&B ${opts.trigger === "NIGHT_AUDIT" ? "Night Audit" : "posting"} — business date ${date}`,
      status,
      sourceModule: FB_SOURCE_MODULE,
      sourceType: opts.trigger ?? "MANUAL",
      sourceRef: `FB:${date}`,
      businessDate: date,
      lines: result.lines.map((l) => ({
        accountId: l.accountId,
        divisionId: l.divisionId,
        entryType: l.entryType,
        amount: l.amount,
        narration: l.narration,
      })),
    });

    const targets: MarkTarget[] = [
      { table: "fb_bills", column: "acc_voucher_id", ids: result.billIds },
      { table: "transactions", column: "acc_voucher_id", ids: result.paymentIds },
      { table: "transactions", column: "acc_void_voucher_id", ids: result.voidIds },
    ];
    if (!(await markPostedBatch(targets, voucher.id))) {
      if (status === "Draft") await deleteVoucher(voucher.id);
      throw new ConflictError("F&B posting ran twice at the same time — refresh and check the vouchers");
    }
    return {
      businessDate: date,
      voucher: { id: voucher.id, voucherNo: voucher.voucherNo, status: voucher.status, totalAmount: voucher.totalAmount },
      totals: result.totals,
      byOutlet: result.byOutlet,
      counts: counts(result),
    };
  },

  /** F&B vouchers, newest first. */
  async history(limit = 30) {
    const { data, error } = await supabase
      .from(accTables.vouchers)
      .select("id, voucher_no, voucher_date, business_date, status, total_amount, source_type, narration, created_at")
      .eq("property_id", pid())
      .eq("source_module", FB_SOURCE_MODULE)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) dbError(error, "F&B vouchers");
    return toCamel<Row[]>(data ?? []).map((v) => ({ ...v, totalAmount: num(v.totalAmount) }));
  },
};

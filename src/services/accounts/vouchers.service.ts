import {
  accTables,
  actorName,
  audit,
  cleanPayload,
  getById,
  insert,
  insertMany,
  isIsoDate,
  isUuid,
  list,
  mustGet,
  num,
  remove,
  removeWhere,
  requireUuid,
  round2,
  todayIso,
  update,
  updateWhere,
  type Row,
} from "../../models/accounts/repo.js";
import { AppError, ConflictError, ValidationError } from "../../errors/index.js";
import { findFiscalYear, findPeriod, resolvePostingWindow } from "./fiscal.service.js";
import { applyAllocations, createBillForVoucher, releaseVoucherBills } from "./bills.service.js";

export type VoucherLineInput = {
  accountId: string;
  partyId?: string | null;
  divisionId?: string | null;
  debit?: number | string;
  credit?: number | string;
  narration?: string;
  chequeNo?: string;
  chequeDate?: string | null;
  gstRate?: number | string | null;
};

export type BillAllocationInput = { billId: string; amount: number | string; deductions?: number | string };

export type NewBillInput = {
  moduleType: "AR" | "AP";
  refType?: string;
  billNo: string;
  billDate?: string;
  dueDate?: string;
  amount?: number | string;
  details?: string;
  partyId?: string;
  divisionId?: string | null;
};

export type VoucherInput = {
  voucherTypeId?: string;
  voucherTypeCode?: string;
  voucherNo?: string;
  voucherDate: string;
  referenceNo?: string;
  narration?: string;
  status?: "Draft" | "Posted" | "Provisional";
  partyId?: string | null;
  divisionId?: string | null;
  bankCashAccountId?: string | null;
  paymentMethodId?: string | null;
  instrumentNo?: string;
  instrumentDate?: string | null;
  provisionalCategory?: string | null;
  provisionalType?: string | null;
  expiryDate?: string | null;
  sourceModule?: string;
  lines: VoucherLineInput[];
  billAllocations?: BillAllocationInput[];
  newBill?: NewBillInput | null;
};

const HEADER_COLUMNS = [
  "referenceNo", "narration", "partyId", "divisionId", "bankCashAccountId", "paymentMethodId", "instrumentNo",
  "instrumentDate", "provisionalCategory", "provisionalType", "expiryDate", "sourceModule",
] as const;

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

function renderPrefix(template: string, date: string, fyCode: string): string {
  return template
    .replace(/\{FY\}/g, fyCode)
    .replace(/\{YYYY\}/g, date.slice(0, 4))
    .replace(/\{YY\}/g, date.slice(2, 4))
    .replace(/\{MM\}/g, date.slice(5, 7));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function nextVoucherNo(voucherType: Row, date: string, fiscalYear: Row): Promise<string> {
  const prefix = renderPrefix(voucherType.prefixTemplate || `${voucherType.shortCode}/`, date, fiscalYear.fyCode);
  const eq: Record<string, string> = { voucher_type_id: voucherType.id };
  if (voucherType.resetFrequency !== "Never") eq.fiscal_year_id = fiscalYear.id;
  const rows = await list(accTables.vouchers, { eq, select: "voucher_no,voucher_date" });
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`);
  let max = num(voucherType.startingNumber) - 1;
  for (const r of rows) {
    if (voucherType.resetFrequency === "Monthly" && String(r.voucherDate).slice(0, 7) !== date.slice(0, 7)) continue;
    const m = String(r.voucherNo).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const pad = num(voucherType.numberPadding) || 5;
  return `${prefix}${String(max + 1).padStart(pad, "0")}`;
}

async function resolveVoucherType(input: { voucherTypeId?: string; voucherTypeCode?: string }): Promise<Row> {
  if (input.voucherTypeId) {
    requireUuid(input.voucherTypeId, "voucherTypeId");
    return mustGet(accTables.voucherTypes, input.voucherTypeId, "Voucher type");
  }
  if (input.voucherTypeCode) {
    const rows = await list(accTables.voucherTypes, { eq: { short_code: input.voucherTypeCode.toUpperCase() } });
    if (rows[0]) return rows[0];
  }
  throw new ValidationError("voucherTypeId is required");
}

export async function previewNextNumber(voucherTypeId: string, date?: string) {
  const vt = await resolveVoucherType({ voucherTypeId });
  const d = isIsoDate(date) ? date : todayIso();
  const fy = await findFiscalYear(d);
  if (!fy) throw new ValidationError(`No fiscal year covers ${d}`);
  return { voucherNo: await nextVoucherNo(vt, d, fy), fiscalYearId: fy.id, fiscalYearName: fy.fiscalYearName };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type PreparedLine = {
  lineNo: number;
  accountId: string;
  partyId: string | null;
  divisionId: string | null;
  debit: number;
  credit: number;
  narration: string;
  chequeNo: string;
  chequeDate: string | null;
  gstRate: number | null;
};

async function prepareLines(voucherType: Row, input: VoucherInput): Promise<{ lines: PreparedLine[]; total: number }> {
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    throw new ValidationError("A voucher needs at least two lines (one debit and one credit)");
  }
  const accounts = await list(accTables.accounts, {
    in: { id: [...new Set(input.lines.map((l) => l.accountId).filter(isUuid))] },
  });
  const byId = new Map(accounts.map((a) => [a.id as string, a]));
  const errors: { path: string; message: string }[] = [];
  const lines: PreparedLine[] = input.lines.map((l, i) => {
    const debit = round2(num(l.debit));
    const credit = round2(num(l.credit));
    const acc = isUuid(l.accountId) ? byId.get(l.accountId) : undefined;
    if (!acc) errors.push({ path: `lines[${i}].accountId`, message: "Select a valid account" });
    else if (acc.accountType !== "Ledger" || !acc.allowPosting) {
      errors.push({ path: `lines[${i}].accountId`, message: `${acc.name} is a group / non-posting account` });
    } else if (acc.status !== "Active") {
      errors.push({ path: `lines[${i}].accountId`, message: `${acc.name} is inactive` });
    }
    if (debit < 0 || credit < 0) errors.push({ path: `lines[${i}]`, message: "Amounts cannot be negative" });
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      errors.push({ path: `lines[${i}]`, message: "Enter either a debit or a credit amount" });
    }
    return {
      lineNo: i + 1,
      accountId: l.accountId,
      partyId: isUuid(l.partyId) ? l.partyId : isUuid(input.partyId) && acc && isPartyAccount(acc) ? input.partyId : null,
      divisionId: isUuid(l.divisionId) ? l.divisionId : isUuid(input.divisionId) ? input.divisionId : null,
      debit,
      credit,
      narration: String(l.narration ?? "").trim(),
      chequeNo: String(l.chequeNo ?? "").trim(),
      chequeDate: isIsoDate(l.chequeDate) ? l.chequeDate : null,
      gstRate: l.gstRate === null || l.gstRate === undefined || l.gstRate === "" ? null : num(l.gstRate),
    };
  });
  if (errors.length) throw new ValidationError(`Line ${errors[0].path.match(/\d+/)?.[0] ? Number(errors[0].path.match(/\d+/)![0]) + 1 : ""}: ${errors[0].message}`, errors);
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) {
    throw new ValidationError(`Debits (${dr.toFixed(2)}) must equal credits (${cr.toFixed(2)})`);
  }
  if (voucherType.partyRequired && !isUuid(input.partyId) && !lines.some((l) => l.partyId)) {
    throw new ValidationError(`${voucherType.voucherTypeName} requires a party`);
  }
  if (voucherType.divisionRequired && !lines.some((l) => l.divisionId)) {
    throw new ValidationError(`${voucherType.voucherTypeName} requires a division`);
  }
  return { lines, total: dr };
}

function isPartyAccount(acc: Row): boolean {
  return acc.category === "Receivables" || acc.category === "Payables" || acc.category === "Advances";
}

async function deriveBankCash(lines: PreparedLine[], explicit?: string | null): Promise<string | null> {
  if (isUuid(explicit)) return explicit;
  const cashBank = await list(accTables.accounts, {
    in: { id: [...new Set(lines.map((l) => l.accountId))] },
    select: "id,is_bank_account,is_cash_account",
  });
  const ids = new Set(cashBank.filter((a) => a.isBankAccount || a.isCashAccount).map((a) => a.id as string));
  return lines.find((l) => ids.has(l.accountId))?.accountId ?? null;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createVoucher(input: VoucherInput, opts: { enforceSettings?: boolean } = {}) {
  if (!isIsoDate(input.voucherDate)) throw new ValidationError("voucherDate (YYYY-MM-DD) is required");
  const voucherType = await resolveVoucherType(input);
  if (voucherType.status !== "Active") throw new ConflictError(`${voucherType.voucherTypeName} is inactive`);

  const status = input.status ?? "Posted";
  if (!["Draft", "Posted", "Provisional"].includes(status)) {
    throw new ValidationError("status must be Draft, Posted or Provisional");
  }
  const { lines, total } = await prepareLines(voucherType, input);

  let fiscalYear: Row;
  let period: Row | null;
  if (status === "Draft") {
    const fy = await findFiscalYear(input.voucherDate);
    if (!fy) throw new ValidationError(`No fiscal year covers ${input.voucherDate}`);
    fiscalYear = fy;
    period = await findPeriod(fy.id, input.voucherDate);
  } else {
    ({ fiscalYear, period } = await resolvePostingWindow(input.voucherDate, opts));
  }

  const header = cleanPayload(input as unknown as Row, HEADER_COLUMNS);
  const actor = await actorName();
  const bankCashAccountId = ["Receipt", "Payment", "Contra"].includes(voucherType.category)
    ? await deriveBankCash(lines, input.bankCashAccountId)
    : isUuid(input.bankCashAccountId) ? input.bankCashAccountId : null;

  const manualNo = String(input.voucherNo ?? "").trim();
  if (voucherType.numberingMethod === "Manual" && !manualNo) {
    throw new ValidationError(`${voucherType.voucherTypeName} uses manual numbering — enter a voucher number`);
  }

  let voucher: Row | null = null;
  for (let attempt = 0; attempt < 5 && !voucher; attempt++) {
    const voucherNo = manualNo || (await nextVoucherNo(voucherType, input.voucherDate, fiscalYear));
    try {
      voucher = await insert(accTables.vouchers, {
        ...header,
        voucherNo,
        voucherDate: input.voucherDate,
        voucherTypeId: voucherType.id,
        voucherCategory: status === "Provisional" ? "Journal" : voucherType.category,
        fiscalYearId: fiscalYear.id,
        fiscalPeriodId: period?.id ?? null,
        status,
        isProvisional: status === "Provisional",
        bankCashAccountId,
        totalAmount: total,
        sourceModule: header.sourceModule || "Accounts",
        preparedBy: actor,
        postedAt: status === "Posted" ? new Date().toISOString() : null,
        postedBy: status === "Posted" ? actor : null,
      });
    } catch (e) {
      if (e instanceof ConflictError && !manualNo) continue;
      throw e;
    }
  }
  if (!voucher) throw new AppError("Could not allocate a voucher number, please retry", 409, "CONFLICT");

  try {
    await insertMany(accTables.voucherLines, lines.map((l) => ({ ...l, voucherId: voucher!.id })));
  } catch (e) {
    await remove(accTables.vouchers, voucher.id);
    throw e;
  }

  if (status === "Posted") {
    if (input.newBill) await createBillForVoucher(voucher, input.newBill, total);
    if (input.billAllocations?.length) await applyAllocations(voucher, input.billAllocations);
  }
  await audit("voucher", voucher.id, status === "Posted" ? "Posted" : `Created (${status})`, {
    details: { voucherNo: voucher.voucherNo, total },
  });
  return getVoucher(voucher.id);
}

export async function updateVoucher(id: string, input: VoucherInput) {
  requireUuid(id);
  const existing = await mustGet(accTables.vouchers, id, "Voucher");
  if (!["Draft", "Provisional"].includes(existing.status)) {
    throw new ConflictError(`${existing.status} vouchers cannot be edited — reverse and re-enter instead`);
  }
  const voucherType = await mustGet(accTables.voucherTypes, existing.voucherTypeId, "Voucher type");
  if (input.voucherTypeId && input.voucherTypeId !== existing.voucherTypeId) {
    throw new ConflictError("Voucher type cannot be changed after creation");
  }
  const date = isIsoDate(input.voucherDate) ? input.voucherDate : existing.voucherDate;
  const { lines, total } = await prepareLines(voucherType, { ...input, voucherDate: date });
  let fiscalYear: Row;
  let period: Row | null;
  if (existing.status === "Draft") {
    const fy = await findFiscalYear(date);
    if (!fy) throw new ValidationError(`No fiscal year covers ${date}`);
    fiscalYear = fy;
    period = await findPeriod(fy.id, date);
  } else {
    ({ fiscalYear, period } = await resolvePostingWindow(date));
  }
  if (fiscalYear.id !== existing.fiscalYearId) {
    throw new ConflictError("Voucher date must stay within the same fiscal year");
  }
  const header = cleanPayload(input as unknown as Row, HEADER_COLUMNS);
  await update(accTables.vouchers, id, {
    ...header,
    voucherDate: date,
    fiscalPeriodId: period?.id ?? null,
    totalAmount: total,
    bankCashAccountId: ["Receipt", "Payment", "Contra"].includes(voucherType.category)
      ? await deriveBankCash(lines, input.bankCashAccountId)
      : existing.bankCashAccountId,
  });
  await removeWhere(accTables.voucherLines, { voucher_id: id });
  await insertMany(accTables.voucherLines, lines.map((l) => ({ ...l, voucherId: id })));
  await audit("voucher", id, "Edited", { details: { total } });
  return getVoucher(id);
}

export async function deleteVoucher(id: string) {
  requireUuid(id);
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  if (v.status !== "Draft") throw new ConflictError("Only draft vouchers can be deleted");
  await remove(accTables.vouchers, id);
  await audit("voucher", id, "Deleted", { details: { voucherNo: v.voucherNo } });
  return { id };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function postVoucher(id: string, body: { billAllocations?: BillAllocationInput[]; newBill?: NewBillInput } = {}) {
  requireUuid(id);
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  if (v.status !== "Draft") throw new ConflictError(`Only draft vouchers can be posted (current: ${v.status})`);
  await resolvePostingWindow(v.voucherDate);
  const actor = await actorName();
  const posted = await update(accTables.vouchers, id, {
    status: "Posted",
    postedAt: new Date().toISOString(),
    postedBy: actor,
  });
  if (body.newBill) await createBillForVoucher(posted, body.newBill, num(v.totalAmount));
  if (body.billAllocations?.length) await applyAllocations(posted, body.billAllocations);
  await audit("voucher", id, "Posted", { details: { voucherNo: v.voucherNo } });
  return getVoucher(id);
}

export async function reverseVoucher(id: string, reason: string) {
  requireUuid(id);
  if (!reason?.trim()) throw new ValidationError("A reversal reason is required");
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  if (!["Posted", "Provisional"].includes(v.status)) {
    throw new ConflictError(`${v.status} vouchers cannot be reversed`);
  }
  await resolvePostingWindow(v.voucherDate, { enforceSettings: false });
  if (v.status === "Posted") await releaseVoucherBills(v);
  const actor = await actorName();
  await update(accTables.vouchers, id, {
    status: "Reversed",
    reversedAt: new Date().toISOString(),
    reversedBy: actor,
    reversalReason: reason.trim(),
  });
  await updateWhere(accTables.voucherLines, { reconciled: false, reconDate: null, reconciledBy: null, reconciledAt: null }, {
    eq: { voucher_id: id },
  });
  await audit("voucher", id, "Reversed", { reason: reason.trim(), details: { voucherNo: v.voucherNo } });
  return getVoucher(id);
}

export async function convertProvisional(id: string, body: { voucherDate?: string; voucherTypeId?: string; narration?: string }) {
  requireUuid(id);
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  if (v.status !== "Provisional") throw new ConflictError("Only provisional entries can be converted");
  const lines = await list(accTables.voucherLines, { eq: { voucher_id: id }, order: [{ column: "line_no" }] });
  let voucherTypeId = body.voucherTypeId;
  if (!voucherTypeId) {
    const jv = await list(accTables.voucherTypes, { eq: { short_code: "JV" }, limit: 1 });
    const anyJournal = jv[0] ?? (await list(accTables.voucherTypes, { eq: { category: "Journal", status: "Active" }, limit: 1 }))[0];
    if (!anyJournal) throw new ValidationError("No Journal voucher type is configured");
    voucherTypeId = anyJournal.id;
  }
  const converted = await createVoucher({
    voucherTypeId,
    voucherDate: isIsoDate(body.voucherDate) ? body.voucherDate : todayIso(),
    referenceNo: v.voucherNo,
    narration: body.narration?.trim() || `${v.narration} (converted from ${v.voucherNo})`,
    partyId: v.partyId,
    divisionId: v.divisionId,
    status: "Posted",
    sourceModule: "Provisional Conversion",
    lines: lines.map((l) => ({
      accountId: l.accountId,
      partyId: l.partyId,
      divisionId: l.divisionId,
      debit: l.debit,
      credit: l.credit,
      narration: l.narration,
    })),
  });
  await update(accTables.vouchers, id, { status: "Converted", convertedVoucherId: converted.id });
  await audit("voucher", id, "Converted", { details: { convertedVoucherId: converted.id, voucherNo: converted.voucherNo } });
  return { provisional: await getVoucher(id), voucher: converted };
}

export async function markPrinted(id: string) {
  requireUuid(id);
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  const row = await update(accTables.vouchers, id, {
    reprintCount: num(v.reprintCount) + 1,
    lastPrintedAt: new Date().toISOString(),
  });
  await audit("voucher", id, v.reprintCount > 0 ? "Reprinted" : "Printed", { details: { count: row.reprintCount } });
  return getVoucher(id);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function lookupMaps() {
  const [types, accounts, parties, divisions, methods, years] = await Promise.all([
    list(accTables.voucherTypes, { select: "id,voucher_type_name,short_code,category" }),
    list(accTables.accounts, { select: "id,code,name,is_bank_account,is_cash_account" }),
    list(accTables.parties, { select: "id,party_code,party_name,party_group" }),
    list(accTables.divisions, { select: "id,division_code,division_name" }),
    list(accTables.paymentMethods, { select: "id,payment_method_name,method_type" }),
    list(accTables.fiscalYears, { select: "id,fiscal_year_name,fy_code" }),
  ]);
  const m = <T extends Row>(rows: T[]) => new Map(rows.map((r) => [r.id as string, r]));
  return {
    types: m(types),
    accounts: m(accounts),
    parties: m(parties),
    divisions: m(divisions),
    methods: m(methods),
    years: m(years),
  };
}

type Maps = Awaited<ReturnType<typeof lookupMaps>>;

function decorateLine(l: Row, maps: Maps): Row {
  const acc = maps.accounts.get(l.accountId);
  return {
    ...l,
    debit: num(l.debit),
    credit: num(l.credit),
    gstRate: l.gstRate === null ? null : num(l.gstRate),
    accountCode: acc?.code ?? null,
    accountName: acc?.name ?? null,
    partyName: l.partyId ? maps.parties.get(l.partyId)?.partyName ?? null : null,
    divisionName: l.divisionId ? maps.divisions.get(l.divisionId)?.divisionName ?? null : null,
  };
}

function decorateVoucher(v: Row, maps: Maps, lines: Row[]): Row {
  const t = maps.types.get(v.voucherTypeId);
  const decorated = lines.map((l) => decorateLine(l, maps));
  const drLines = decorated.filter((l) => l.debit > 0);
  const crLines = decorated.filter((l) => l.credit > 0);
  return {
    ...v,
    totalAmount: num(v.totalAmount),
    voucherTypeName: t?.voucherTypeName ?? null,
    voucherTypeCode: t?.shortCode ?? null,
    partyName: v.partyId ? maps.parties.get(v.partyId)?.partyName ?? null : decorated.find((l) => l.partyName)?.partyName ?? null,
    divisionName: v.divisionId ? maps.divisions.get(v.divisionId)?.divisionName ?? null : null,
    bankCashAccountName: v.bankCashAccountId ? maps.accounts.get(v.bankCashAccountId)?.name ?? null : null,
    paymentMethodName: v.paymentMethodId ? maps.methods.get(v.paymentMethodId)?.paymentMethodName ?? null : null,
    fiscalYearName: v.fiscalYearId ? maps.years.get(v.fiscalYearId)?.fiscalYearName ?? null : null,
    debitAccounts: [...new Set(drLines.map((l) => l.accountName))].join(", "),
    creditAccounts: [...new Set(crLines.map((l) => l.accountName))].join(", "),
    lines: decorated,
  };
}

export async function listVouchers(query: Record<string, unknown>) {
  const csv = (v: unknown) =>
    typeof v === "string" && v.trim() && v !== "all" ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const from = isIsoDate(query.from) ? query.from : undefined;
  const to = isIsoDate(query.to) ? query.to : undefined;
  const vouchers = await list(accTables.vouchers, {
    eq: {
      voucher_type_id: isUuid(query.voucherTypeId) ? query.voucherTypeId : undefined,
      party_id: isUuid(query.partyId) ? query.partyId : undefined,
      bank_cash_account_id: isUuid(query.bankCashAccountId) ? query.bankCashAccountId : undefined,
      is_provisional: query.provisional === "true" ? true : query.provisional === "false" ? false : undefined,
      fiscal_year_id: isUuid(query.fiscalYearId) ? query.fiscalYearId : undefined,
    },
    in: { status: csv(query.status), voucher_category: csv(query.category) },
    gte: { voucher_date: from },
    lte: { voucher_date: to },
    order: [{ column: "voucher_date", ascending: false }, { column: "voucher_no", ascending: false }],
    limit: query.limit ? Math.min(num(query.limit), 5000) : undefined,
  });
  if (vouchers.length === 0) return [];
  const minDate = vouchers.reduce((m, v) => (v.voucherDate < m ? v.voucherDate : m), vouchers[0].voucherDate);
  const maxDate = vouchers.reduce((m, v) => (v.voucherDate > m ? v.voucherDate : m), vouchers[0].voucherDate);
  const ids = new Set(vouchers.map((v) => v.id as string));
  const [maps, lines] = await Promise.all([
    lookupMaps(),
    list(accTables.voucherLines, {
      select: "*,acc_vouchers!inner(voucher_date)",
      gte: { "acc_vouchers.voucher_date": minDate },
      lte: { "acc_vouchers.voucher_date": maxDate },
      order: [{ column: "line_no" }],
    }),
  ]);
  const byVoucher = new Map<string, Row[]>();
  for (const l of lines) {
    if (!ids.has(l.voucherId)) continue;
    const { accVouchers: _omit, ...rest } = l;
    const arr = byVoucher.get(l.voucherId) ?? [];
    arr.push(rest);
    byVoucher.set(l.voucherId, arr);
  }
  let out = vouchers.map((v) => decorateVoucher(v, maps, byVoucher.get(v.id) ?? []));
  const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
  if (search) {
    out = out.filter((v) =>
      [v.voucherNo, v.narration, v.referenceNo, v.partyName, v.debitAccounts, v.creditAccounts, v.instrumentNo]
        .some((s) => typeof s === "string" && s.toLowerCase().includes(search)),
    );
  }
  return out;
}

export async function getVoucher(id: string): Promise<Row> {
  requireUuid(id);
  const v = await mustGet(accTables.vouchers, id, "Voucher");
  const [maps, lines, settlements, bills, logs] = await Promise.all([
    lookupMaps(),
    list(accTables.voucherLines, { eq: { voucher_id: id }, order: [{ column: "line_no" }] }),
    list(accTables.billSettlements, { eq: { voucher_id: id } }),
    list(accTables.partyBills, { eq: { voucher_id: id } }),
    list(accTables.auditLogs, { eq: { entity_type: "voucher", entity_id: id }, order: [{ column: "created_at", ascending: false }] }),
  ]);
  const billIds = [...new Set(settlements.map((s) => s.billId as string))];
  const settledBills = billIds.length ? await list(accTables.partyBills, { in: { id: billIds } }) : [];
  const billNo = new Map(settledBills.map((b) => [b.id as string, b]));
  return {
    ...decorateVoucher(v, maps, lines),
    allocations: settlements.map((s) => ({
      ...s,
      amount: num(s.amount),
      deductions: num(s.deductions),
      billNo: billNo.get(s.billId)?.billNo ?? null,
      billDate: billNo.get(s.billId)?.billDate ?? null,
      billAmount: billNo.has(s.billId) ? num(billNo.get(s.billId)!.amount) : null,
    })),
    bills: bills.map((b) => ({ ...b, amount: num(b.amount) })),
    auditLogs: logs,
  };
}

// ---------------------------------------------------------------------------
// Receipts & payments (simplified single-bank entry)
// ---------------------------------------------------------------------------

export type ReceiptPaymentInput = {
  type: "Receipt" | "Payment";
  voucherTypeId?: string;
  voucherDate: string;
  bankCashAccountId: string;
  paymentMethodId?: string | null;
  instrumentNo?: string;
  instrumentDate?: string | null;
  referenceNo?: string;
  narration?: string;
  partyId?: string | null;
  status?: "Draft" | "Posted";
  lines: {
    accountId: string;
    partyId?: string | null;
    divisionId?: string | null;
    amount: number | string;
    narration?: string;
    billId?: string | null;
  }[];
};

export async function createReceiptPayment(input: ReceiptPaymentInput) {
  if (input.type !== "Receipt" && input.type !== "Payment") {
    throw new ValidationError("type must be Receipt or Payment");
  }
  if (!isUuid(input.bankCashAccountId)) throw new ValidationError("Select the bank / cash account");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ValidationError("Add at least one line");
  const bank = await getById(accTables.accounts, input.bankCashAccountId);
  if (!bank || (!bank.isBankAccount && !bank.isCashAccount)) {
    throw new ValidationError("The selected account is not a bank or cash account");
  }
  if (isUuid(input.paymentMethodId)) {
    const pm = await getById(accTables.paymentMethods, input.paymentMethodId);
    if (pm?.referenceRequired && !String(input.instrumentNo ?? "").trim()) {
      throw new ValidationError(`${pm.paymentMethodName} requires a reference / instrument number`);
    }
  }
  let voucherTypeId = input.voucherTypeId;
  if (!voucherTypeId) {
    const code = input.type === "Receipt" ? "RV" : "PV";
    const vt =
      (await list(accTables.voucherTypes, { eq: { short_code: code, status: "Active" }, limit: 1 }))[0] ??
      (await list(accTables.voucherTypes, { eq: { category: input.type, status: "Active" }, limit: 1 }))[0];
    if (!vt) throw new ValidationError(`No active ${input.type} voucher type is configured`);
    voucherTypeId = vt.id;
  }
  const total = round2(input.lines.reduce((s, l) => s + num(l.amount), 0));
  if (total <= 0) throw new ValidationError("Total amount must be greater than zero");
  const isReceipt = input.type === "Receipt";
  const lines: VoucherLineInput[] = [
    {
      accountId: input.bankCashAccountId,
      debit: isReceipt ? total : 0,
      credit: isReceipt ? 0 : total,
      narration: input.narration ?? "",
      chequeNo: input.instrumentNo ?? "",
      chequeDate: input.instrumentDate ?? null,
    },
    ...input.lines.map((l) => ({
      accountId: l.accountId,
      partyId: l.partyId ?? input.partyId ?? null,
      divisionId: l.divisionId ?? null,
      debit: isReceipt ? 0 : num(l.amount),
      credit: isReceipt ? num(l.amount) : 0,
      narration: l.narration ?? "",
    })),
  ];
  const billAllocations = input.lines
    .filter((l) => isUuid(l.billId))
    .map((l) => ({ billId: l.billId as string, amount: l.amount }));
  return createVoucher({
    voucherTypeId,
    voucherDate: input.voucherDate,
    referenceNo: input.referenceNo,
    narration: input.narration,
    partyId: input.partyId ?? null,
    bankCashAccountId: input.bankCashAccountId,
    paymentMethodId: input.paymentMethodId ?? null,
    instrumentNo: input.instrumentNo,
    instrumentDate: input.instrumentDate ?? null,
    status: input.status ?? "Posted",
    lines,
    billAllocations,
  });
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

export async function bankReconciliation(query: Record<string, unknown>) {
  const bankAccounts = await list(accTables.accounts, {
    eq: { is_bank_account: true },
    order: [{ column: "code" }],
  });
  const accountId = isUuid(query.bankAccountId) ? query.bankAccountId : bankAccounts[0]?.id;
  if (!accountId) return { bankAccounts: [], account: null, entries: [], summary: null };
  const account: Row = bankAccounts.find((a) => a.id === accountId) ?? (await mustGet(accTables.accounts, accountId, "Bank account"));
  const from = isIsoDate(query.from) ? query.from : undefined;
  const to = isIsoDate(query.to) ? query.to : todayIso();
  const status = typeof query.status === "string" ? query.status : "all";

  const all = await list(accTables.voucherLines, {
    select:
      "*,acc_vouchers!inner(voucher_no,voucher_date,voucher_category,narration,reference_no,instrument_no,instrument_date,status,party_id)",
    eq: { account_id: accountId, "acc_vouchers.status": "Posted" },
    lte: { "acc_vouchers.voucher_date": to },
  });
  const parties = await list(accTables.parties, { select: "id,party_name" });
  const partyName = new Map(parties.map((p) => [p.id as string, p.partyName as string]));

  let bookBalance = 0;
  let unreconciledDebit = 0;
  let unreconciledCredit = 0;
  let bankBalance = 0;
  const entries: Row[] = [];
  for (const l of all) {
    const v = l.accVouchers;
    const dr = num(l.debit);
    const cr = num(l.credit);
    bookBalance += dr - cr;
    if (l.reconciled && l.reconDate && l.reconDate <= to) bankBalance += dr - cr;
    else {
      unreconciledDebit += dr;
      unreconciledCredit += cr;
    }
    if (from && v.voucherDate < from && l.reconciled) continue;
    if (status === "reconciled" && !l.reconciled) continue;
    if (status === "unreconciled" && l.reconciled) continue;
    entries.push({
      id: l.id,
      voucherId: l.voucherId,
      voucherNo: v.voucherNo,
      voucherDate: v.voucherDate,
      voucherCategory: v.voucherCategory,
      narration: l.narration || v.narration,
      referenceNo: v.referenceNo,
      instrumentNo: l.chequeNo || v.instrumentNo,
      instrumentDate: l.chequeDate ?? v.instrumentDate,
      partyName: (l.partyId && partyName.get(l.partyId)) || (v.partyId && partyName.get(v.partyId)) || null,
      debit: dr,
      credit: cr,
      reconciled: Boolean(l.reconciled),
      reconDate: l.reconDate,
      reconciledBy: l.reconciledBy,
      reconciledAt: l.reconciledAt,
    });
  }
  entries.sort((a, b) => a.voucherDate.localeCompare(b.voucherDate) || a.voucherNo.localeCompare(b.voucherNo));
  return {
    bankAccounts: bankAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name, bankAccountNo: a.bankAccountNo, bankIfsc: a.bankIfsc })),
    account: { id: account.id, code: account.code, name: account.name, bankAccountNo: account.bankAccountNo, bankIfsc: account.bankIfsc },
    asOn: to,
    entries,
    summary: {
      bookBalance: round2(bookBalance),
      balanceAsPerBank: round2(bankBalance),
      unreconciledDebit: round2(unreconciledDebit),
      unreconciledCredit: round2(unreconciledCredit),
      unreconciledCount: all.filter((l) => !l.reconciled).length,
      difference: round2(bookBalance - bankBalance - (unreconciledDebit - unreconciledCredit)),
    },
  };
}

export async function reconcileLines(items: { lineId: string; reconDate: string }[]) {
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError("Select entries to reconcile");
  const actor = await actorName();
  const now = new Date().toISOString();
  let updated = 0;
  for (const item of items) {
    requireUuid(item.lineId, "lineId");
    if (!isIsoDate(item.reconDate)) throw new ValidationError("Each entry needs a bank (clearing) date");
    const line = await mustGet(accTables.voucherLines, item.lineId, "Entry");
    const v = await mustGet(accTables.vouchers, line.voucherId, "Voucher");
    if (v.status !== "Posted") throw new ConflictError(`${v.voucherNo} is not posted`);
    if (item.reconDate < v.voucherDate) {
      throw new ValidationError(`Clearing date for ${v.voucherNo} cannot be before the voucher date`);
    }
    await update(accTables.voucherLines, item.lineId, {
      reconciled: true,
      reconDate: item.reconDate,
      reconciledBy: actor,
      reconciledAt: now,
    });
    updated++;
  }
  await audit("bank_reconciliation", null, "Reconciled", { details: { count: updated } });
  return { reconciled: updated };
}

export async function unreconcileLines(lineIds: string[], reason: string) {
  if (!Array.isArray(lineIds) || lineIds.length === 0) throw new ValidationError("Select entries to unreconcile");
  if (!reason?.trim()) throw new ValidationError("A reason is required to unreconcile");
  lineIds.forEach((id) => requireUuid(id, "lineId"));
  const n = await updateWhere(
    accTables.voucherLines,
    { reconciled: false, reconDate: null, reconciledBy: null, reconciledAt: null },
    { in: { id: lineIds } },
  );
  await audit("bank_reconciliation", null, "Unreconciled", { reason: reason.trim(), details: { lineIds } });
  return { unreconciled: n };
}

// ---------------------------------------------------------------------------
// Closing stock posting
// ---------------------------------------------------------------------------

export async function postClosingStock(body: { itemIds?: string[]; valuationDate?: string; postingDate?: string }) {
  let items: Row[];
  if (Array.isArray(body.itemIds) && body.itemIds.length) {
    body.itemIds.forEach((id) => requireUuid(id, "itemId"));
    items = await list(accTables.closingStock, { in: { id: body.itemIds } });
  } else if (isIsoDate(body.valuationDate)) {
    items = await list(accTables.closingStock, { eq: { valuation_date: body.valuationDate } });
  } else {
    throw new ValidationError("Provide itemIds or a valuationDate");
  }
  items = items.filter((i) => i.status !== "GL Posted");
  if (items.length === 0) throw new ConflictError("Nothing to post — items are already posted");
  const notAudited = items.filter((i) => i.status !== "Audited");
  if (notAudited.length) {
    throw new ConflictError(`${notAudited.length} item(s) are still Draft — audit them before posting`);
  }
  const missing = items.filter((i) => !i.stockAccountId || !i.consumptionAccountId);
  if (missing.length) {
    throw new ValidationError(`Map stock and consumption accounts for: ${missing.map((i) => i.itemCode).join(", ")}`);
  }
  const date = isIsoDate(body.postingDate) ? body.postingDate : items[0].valuationDate;
  const net = new Map<string, { stock: string; cons: string; diff: number }>();
  for (const i of items) {
    const key = `${i.stockAccountId}|${i.consumptionAccountId}`;
    const cur = net.get(key) ?? { stock: i.stockAccountId, cons: i.consumptionAccountId, diff: 0 };
    cur.diff = round2(cur.diff + num(i.physicalQty) * num(i.unitRate) - num(i.prevPeriodValue));
    net.set(key, cur);
  }
  const lines: VoucherLineInput[] = [];
  for (const g of net.values()) {
    if (g.diff === 0) continue;
    const amt = Math.abs(g.diff);
    if (g.diff > 0) {
      lines.push({ accountId: g.stock, debit: amt, narration: "Closing stock increase" });
      lines.push({ accountId: g.cons, credit: amt, narration: "Reduction in consumption" });
    } else {
      lines.push({ accountId: g.cons, debit: amt, narration: "Additional consumption" });
      lines.push({ accountId: g.stock, credit: amt, narration: "Closing stock decrease" });
    }
  }
  let voucher: Row | null = null;
  if (lines.length) {
    voucher = await createVoucher({
      voucherTypeCode: "JV",
      voucherDate: date,
      referenceNo: `STK-${date}`,
      narration: `Closing stock valuation as on ${date}`,
      status: "Posted",
      sourceModule: "Closing Stock",
      lines,
    });
  }
  await updateWhere(
    accTables.closingStock,
    { status: "GL Posted", voucherId: voucher?.id ?? null },
    { in: { id: items.map((i) => i.id as string) } },
  );
  await audit("closing_stock", voucher?.id ?? null, "Posted to GL", { details: { items: items.length, date } });
  return { posted: items.length, voucher };
}

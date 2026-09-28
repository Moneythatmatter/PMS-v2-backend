import {
  accTables,
  actorName,
  audit,
  count,
  insertMany,
  list,
  mustGet,
  num,
  requireUuid,
  round2,
  todayIso,
  update,
  updateWhere,
  type Row,
} from "../../models/accounts/repo.js";
import { ConflictError, ValidationError } from "../../errors/index.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthEnd(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

export async function generatePeriodsForYear(fy: { id: string; startDate: string; endDate: string }) {
  const existing = await count(accTables.fiscalPeriods, { fiscal_year_id: fy.id });
  if (existing > 0) return;
  const rows: Row[] = [];
  let y = parseInt(fy.startDate.slice(0, 4), 10);
  let m = parseInt(fy.startDate.slice(5, 7), 10) - 1;
  let start = fy.startDate;
  for (let n = 1; start <= fy.endDate && n <= 24; n++) {
    const endCandidate = monthEnd(y, m);
    const end = endCandidate > fy.endDate ? fy.endDate : endCandidate;
    rows.push({
      fiscalYearId: fy.id,
      periodNo: n,
      periodCode: `P-${String(n).padStart(2, "0")}`,
      periodName: `${MONTHS[m]} ${y}`,
      startDate: start,
      endDate: end,
      status: "Open",
    });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  await insertMany(accTables.fiscalPeriods, rows);
}

export async function getSettings(): Promise<Row | null> {
  const rows = await list(accTables.companySettings, { order: [{ column: "created_at" }], limit: 1 });
  return rows[0] ?? null;
}

export async function findFiscalYear(date: string): Promise<Row | null> {
  const rows = await list(accTables.fiscalYears, { lte: { start_date: date }, gte: { end_date: date } });
  return rows[0] ?? null;
}

export async function findPeriod(fiscalYearId: string, date: string): Promise<Row | null> {
  const rows = await list(accTables.fiscalPeriods, {
    eq: { fiscal_year_id: fiscalYearId },
    lte: { start_date: date },
    gte: { end_date: date },
  });
  return rows[0] ?? null;
}

export async function currentFiscalYear(): Promise<Row | null> {
  const cur = await list(accTables.fiscalYears, { eq: { is_current: true }, limit: 1 });
  if (cur[0]) return cur[0];
  return findFiscalYear(todayIso());
}

/** Resolve fiscal year + period for a voucher date and make sure posting is allowed. */
export async function resolvePostingWindow(
  date: string,
  opts: { enforceSettings?: boolean } = {},
): Promise<{ fiscalYear: Row; period: Row | null }> {
  const fy = await findFiscalYear(date);
  if (!fy) throw new ValidationError(`No fiscal year covers ${date}. Create it under Fiscal Year.`);
  if (fy.status === "Closed") throw new ConflictError(`${fy.fiscalYearName} is closed for posting`);
  if (fy.status === "Upcoming") throw new ConflictError(`${fy.fiscalYearName} is not opened yet`);
  const period = await findPeriod(fy.id, date);
  if (period?.status === "Closed") {
    throw new ConflictError(`Period ${period.periodName} is closed. Reopen it to post on ${date}.`);
  }
  if (opts.enforceSettings !== false) {
    const s = await getSettings();
    const today = todayIso();
    if (s) {
      if (s.lockDateBefore && date <= s.lockDateBefore) {
        throw new ConflictError(`Books are locked up to ${s.lockDateBefore}`);
      }
      if (!s.allowFutureTransactions && date > today) {
        throw new ConflictError("Future-dated transactions are not allowed (Company Settings)");
      }
      if (!s.allowBackDatedPosting && date < today) {
        throw new ConflictError("Back-dated posting is disabled (Company Settings)");
      }
      if (s.allowBackDatedPosting && num(s.backDatedLimitDays) > 0) {
        const limit = new Date(`${today}T00:00:00Z`);
        limit.setUTCDate(limit.getUTCDate() - num(s.backDatedLimitDays));
        const limitIso = limit.toISOString().slice(0, 10);
        if (date < limitIso) {
          throw new ConflictError(
            `Back-dated posting is limited to ${s.backDatedLimitDays} days (on or after ${limitIso})`,
          );
        }
      }
    }
  }
  return { fiscalYear: fy, period };
}

// ---------------------------------------------------------------------------
// Fiscal year lifecycle
// ---------------------------------------------------------------------------

export async function openFiscalYear(id: string) {
  requireUuid(id);
  const fy = await mustGet(accTables.fiscalYears, id, "Fiscal year");
  if (fy.status !== "Upcoming") throw new ConflictError(`Fiscal year is already ${fy.status}`);
  await generatePeriodsForYear(fy as { id: string; startDate: string; endDate: string });
  const actor = await actorName();
  const row = await update(accTables.fiscalYears, id, {
    status: "Open",
    openedAt: new Date().toISOString(),
    openedBy: actor,
    updatedBy: actor,
  });
  await audit("fiscal_year", id, "Opened");
  return row;
}

export async function setCurrentFiscalYear(id: string) {
  requireUuid(id);
  const fy = await mustGet(accTables.fiscalYears, id, "Fiscal year");
  if (fy.status !== "Open") throw new ConflictError("Only an Open fiscal year can be set as current");
  await updateWhere(accTables.fiscalYears, { isCurrent: false }, { eq: { is_current: true } });
  const row = await update(accTables.fiscalYears, id, { isCurrent: true, updatedBy: await actorName() });
  const settings = await getSettings();
  if (settings) await update(accTables.companySettings, settings.id, { currentFiscalYearId: id });
  await audit("fiscal_year", id, "Set Current");
  return row;
}

export async function closeFiscalYear(id: string) {
  requireUuid(id);
  const fy = await mustGet(accTables.fiscalYears, id, "Fiscal year");
  if (fy.status !== "Open") throw new ConflictError("Only an Open fiscal year can be closed");
  if (fy.isCurrent) {
    throw new ConflictError("Set another fiscal year as current before closing this one");
  }
  const openPeriods = await count(accTables.fiscalPeriods, { fiscal_year_id: id, status: "Open" });
  if (openPeriods > 0) throw new ConflictError(`${openPeriods} period(s) are still open`);
  const pending = await count(accTables.vouchers, { fiscal_year_id: id }, { status: ["Draft", "Provisional"] });
  if (pending > 0) throw new ConflictError(`${pending} draft/provisional voucher(s) must be posted or reversed`);
  const actor = await actorName();
  const row = await update(accTables.fiscalYears, id, {
    status: "Closed",
    closedAt: new Date().toISOString(),
    closedBy: actor,
    updatedBy: actor,
  });
  await audit("fiscal_year", id, "Closed");
  return row;
}

export async function reopenFiscalYear(id: string, reason: string) {
  requireUuid(id);
  if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a fiscal year");
  const fy = await mustGet(accTables.fiscalYears, id, "Fiscal year");
  if (fy.status !== "Closed") throw new ConflictError("Only a Closed fiscal year can be reopened");
  const actor = await actorName();
  const row = await update(accTables.fiscalYears, id, {
    status: "Open",
    reopenedAt: new Date().toISOString(),
    reopenedBy: actor,
    reopenReason: reason.trim(),
    updatedBy: actor,
  });
  await audit("fiscal_year", id, "Reopened", { reason: reason.trim() });
  return row;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PeriodChecks = {
  unpostedVouchers: number;
  trialBalanceDifference: number;
  trialBalanced: boolean;
  unreconciledBankLines: number;
  pendingClosingStock: number;
  postedVouchers: number;
  totalDebit: number;
  totalCredit: number;
};

async function periodChecks(periods: Row[]): Promise<Map<string, PeriodChecks>> {
  if (periods.length === 0) return new Map();
  const from = periods.reduce((m, p) => (p.startDate < m ? p.startDate : m), periods[0].startDate);
  const to = periods.reduce((m, p) => (p.endDate > m ? p.endDate : m), periods[0].endDate);
  const [vouchers, lines, bankAccounts, stock] = await Promise.all([
    list(accTables.vouchers, {
      select: "id,voucher_date,status",
      gte: { voucher_date: from },
      lte: { voucher_date: to },
    }),
    list(accTables.voucherLines, {
      select: "account_id,debit,credit,reconciled,acc_vouchers!inner(voucher_date,status)",
      eq: { "acc_vouchers.status": "Posted" },
      gte: { "acc_vouchers.voucher_date": from },
      lte: { "acc_vouchers.voucher_date": to },
    }),
    list(accTables.accounts, { eq: { is_bank_account: true }, select: "id" }),
    list(accTables.closingStock, {
      select: "valuation_date,status",
      gte: { valuation_date: from },
      lte: { valuation_date: to },
    }),
  ]);
  const bankIds = new Set(bankAccounts.map((a) => a.id as string));
  const out = new Map<string, PeriodChecks>();
  for (const p of periods) {
    const inP = (d: string) => d >= p.startDate && d <= p.endDate;
    const pv = vouchers.filter((v) => inP(v.voucherDate));
    const pl = lines.filter((l) => inP(l.accVouchers.voucherDate));
    const dr = round2(pl.reduce((s, l) => s + num(l.debit), 0));
    const cr = round2(pl.reduce((s, l) => s + num(l.credit), 0));
    out.set(p.id, {
      unpostedVouchers: pv.filter((v) => v.status === "Draft" || v.status === "Provisional").length,
      postedVouchers: pv.filter((v) => v.status === "Posted").length,
      totalDebit: dr,
      totalCredit: cr,
      trialBalanceDifference: round2(dr - cr),
      trialBalanced: Math.abs(dr - cr) < 0.005,
      unreconciledBankLines: pl.filter((l) => bankIds.has(l.accountId) && !l.reconciled).length,
      pendingClosingStock: stock.filter((s) => inP(s.valuationDate) && s.status !== "GL Posted").length,
    });
  }
  return out;
}

export async function listPeriods(fiscalYearId?: string) {
  let fyId = fiscalYearId;
  if (!fyId) fyId = (await currentFiscalYear())?.id;
  if (!fyId) return [];
  requireUuid(fyId, "fiscalYearId");
  const [fy, periods] = await Promise.all([
    mustGet(accTables.fiscalYears, fyId, "Fiscal year"),
    list(accTables.fiscalPeriods, { eq: { fiscal_year_id: fyId }, order: [{ column: "period_no" }] }),
  ]);
  const checks = await periodChecks(periods);
  return periods.map((p) => ({
    ...p,
    fiscalYearName: fy.fiscalYearName,
    fiscalYearStatus: fy.status,
    checks: checks.get(p.id),
  }));
}

export async function closePeriod(id: string, opts: { force?: boolean } = {}) {
  requireUuid(id);
  const period = await mustGet(accTables.fiscalPeriods, id, "Period");
  if (period.status === "Closed") throw new ConflictError("Period is already closed");
  const fy = await mustGet(accTables.fiscalYears, period.fiscalYearId, "Fiscal year");
  if (fy.status !== "Open") throw new ConflictError(`${fy.fiscalYearName} is ${fy.status}`);
  const earlierOpen = await list(accTables.fiscalPeriods, {
    eq: { fiscal_year_id: fy.id, status: "Open" },
    lte: { period_no: period.periodNo - 1 },
  });
  if (earlierOpen.length > 0) {
    throw new ConflictError(`Close ${earlierOpen[0].periodName} first — periods close in order`);
  }
  const c = (await periodChecks([period])).get(id)!;
  if (c.unpostedVouchers > 0) {
    throw new ConflictError(`${c.unpostedVouchers} draft/provisional voucher(s) exist in this period`);
  }
  if (!c.trialBalanced) throw new ConflictError(`Trial balance differs by ${c.trialBalanceDifference}`);
  if (!opts.force && c.unreconciledBankLines > 0) {
    throw new ConflictError(`${c.unreconciledBankLines} bank entries are not reconciled`);
  }
  if (!opts.force && c.pendingClosingStock > 0) {
    throw new ConflictError(`${c.pendingClosingStock} closing stock item(s) are not posted to GL`);
  }
  const actor = await actorName();
  const row = await update(accTables.fiscalPeriods, id, {
    status: "Closed",
    closedAt: new Date().toISOString(),
    closedBy: actor,
  });
  await audit("fiscal_period", id, "Closed", { details: { checks: c, force: Boolean(opts.force) } });
  return { ...row, checks: c };
}

export async function reopenPeriod(id: string, reason: string) {
  requireUuid(id);
  if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a period");
  const period = await mustGet(accTables.fiscalPeriods, id, "Period");
  if (period.status !== "Closed") throw new ConflictError("Period is not closed");
  const fy = await mustGet(accTables.fiscalYears, period.fiscalYearId, "Fiscal year");
  if (fy.status === "Closed") throw new ConflictError(`Reopen ${fy.fiscalYearName} first`);
  const actor = await actorName();
  const row = await update(accTables.fiscalPeriods, id, {
    status: "Open",
    reopenedAt: new Date().toISOString(),
    reopenedBy: actor,
    reopenReason: reason.trim(),
  });
  await audit("fiscal_period", id, "Reopened", { reason: reason.trim() });
  return row;
}

export async function listAuditLogs(query: { entityType?: string; entityId?: string; limit?: number }) {
  return list(accTables.auditLogs, {
    eq: { entity_type: query.entityType, entity_id: query.entityId },
    order: [{ column: "created_at", ascending: false }],
    limit: query.limit ?? 200,
  });
}

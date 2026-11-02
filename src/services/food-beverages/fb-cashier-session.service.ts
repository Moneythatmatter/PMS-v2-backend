import { supabase } from "../../utils/supabase.js";
import { toSnake } from "../../utils/mappers.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError, PermissionError } from "../../errors/index.js";
import { currentBusinessDate } from "../front-office/business-date.js";
import { outletBySourceId } from "./fb-outlet-payments.js";
import type { Transaction } from "../../types/transactions.js";

const METHODS = [
  { key: "CASH", label: "Cash" },
  { key: "UPI", label: "UPI" },
  { key: "CARD", label: "Card" },
  { key: "BANK_TRANSFER", label: "Bank Transfer" },
  { key: "CHEQUE", label: "Cheque" },
  { key: "OTHER", label: "Other" },
] as const;

const SESSION_COLUMN = "fb_cashier_session_id";
const SETUP_HINT = "Run backend/sql/fb-cashier-day-close.sql in Supabase.";

export type FbCashierLine = {
  paymentMethod: string;
  openingAmount: number;
  totalReceived: number;
  totalRefunded: number;
  totalPaidOut: number;
  expectedAmount: number;
  actualAmount: number | null;
  variance: number | null;
  remarks: string | null;
};

type SessionRow = Record<string, unknown> & {
  id: string;
  propertyId: string;
  outletId: string;
  cashierId: string;
  shiftName: string;
  openedAt: string;
  openingCash: number;
  status: string;
  closingRemarks?: string | null;
};

type LineInput = { paymentMethod: string; actualAmount: number | null; remarks?: string | null };
type Row = Record<string, unknown>;

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function wrapSetupError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/fb_cashier_session|fb_outlet_day_closings/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) {
    throw new AppError(`F&B cashier closing is not set up yet. ${SETUP_HINT}`);
  }
  throw e;
}

function requireProperty() {
  const propertyId = getActivePropertyId();
  if (!propertyId) throw new AppError("Select a property before using the cashier desk");
  return propertyId;
}

function requireUser() {
  const userId = getRequestStore()?.userId;
  if (!userId) throw new AppError("Sign in is required", 401);
  return userId;
}

function requireOutlet(outletId: unknown) {
  const id = String(outletId ?? "").trim();
  if (!id) throw new AppError("Select the outlet");
  return id;
}

export function canApproveCashier() {
  const store = getRequestStore();
  if (store?.isSuperAdmin) return true;
  const role = String(store?.userRole ?? "").toLowerCase();
  return role === "admin" || role === "administrator" || role === "manager";
}

function methodKey(value: string) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (METHODS.some((m) => m.key === raw)) return raw;
  if (/UPI|GPAY|PHONEPE|PAYTM/.test(raw)) return "UPI";
  if (/CARD|CREDIT|DEBIT/.test(raw)) return "CARD";
  if (/BANK|NEFT|RTGS|IMPS/.test(raw)) return "BANK_TRANSFER";
  if (/CHEQUE|CHECK/.test(raw)) return "CHEQUE";
  return "OTHER";
}

async function audit(sessionId: string, action: string, fromStatus: string | null, toStatus: string | null, snapshot: unknown, remarks?: string | null) {
  await fbModel.create(fbModel.tables.cashierSessionAudits, {
    cashierSessionId: sessionId,
    action,
    actorId: getRequestStore()?.userId ?? null,
    fromStatus,
    toStatus,
    snapshot,
    remarks: remarks ?? null,
  });
}

async function userNames(ids: unknown[]) {
  const map = new Map<string, { name: string; email: string | null }>();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!unique.length) return map;
  const { data, error } = await supabase.from("users").select("id, name, email").in("id", unique);
  if (error) return map;
  for (const row of (data ?? []) as { id: string; name: string | null; email: string | null }[]) {
    map.set(row.id, { name: row.name || row.email || "Unknown user", email: row.email });
  }
  return map;
}

async function outletNames(): Promise<Map<string, string>> {
  const outlets = await fbModel.list<Row>(fbModel.tables.outlets).catch(() => [] as Row[]);
  return new Map(outlets.map((o) => [String(o.id), String(o.name ?? o.id)]));
}

async function withNames<T extends Record<string, unknown>>(rows: T[]) {
  const [names, outlets] = await Promise.all([
    userNames(rows.flatMap((r) => [r.cashierId, r.closedBy, r.approvedBy])),
    outletNames(),
  ]);
  const nameOf = (id: unknown) => (typeof id === "string" ? names.get(id)?.name ?? null : null);
  return rows.map((r) => ({
    ...r,
    outletName: outlets.get(String(r.outletId)) ?? null,
    cashierName: nameOf(r.cashierId),
    cashierEmail: typeof r.cashierId === "string" ? names.get(r.cashierId)?.email ?? null : null,
    closedByName: nameOf(r.closedBy),
    approvedByName: nameOf(r.approvedBy),
  }));
}

async function loadSession(id: string) {
  const row = await fbModel.get<SessionRow>(fbModel.tables.cashierSessions, id).catch(wrapSetupError);
  if (!row) throw new AppError("Cashier session not found", 404);
  return row;
}

function assertEditable(session: SessionRow) {
  if (session.status === "Closed" || session.status === "Pending Approval") {
    throw new AppError("This cashier session is locked");
  }
}

async function findSessions(filters: Record<string, string>, limit?: number) {
  return fbModel
    .list<SessionRow>(fbModel.tables.cashierSessions, { filters, orderBy: "opened_at", ascending: false, limit })
    .catch(wrapSetupError);
}

export const FbCashierSessionService = {
  async list(input: { outletId?: string; status?: string; businessDate?: string } = {}) {
    const filters: Record<string, string> = {};
    if (input.outletId) filters.outlet_id = input.outletId;
    if (input.status) filters.status = input.status;
    if (input.businessDate) filters.business_date = input.businessDate;
    return withNames(await findSessions(filters));
  },

  async activeForCurrentUser(outletIdInput: unknown) {
    const propertyId = requireProperty();
    const userId = requireUser();
    const outletId = requireOutlet(outletIdInput);
    const base = { property_id: propertyId, outlet_id: outletId, cashier_id: userId };
    const open = await findSessions({ ...base, status: "Open" }, 1);
    if (open[0]) return open[0];
    const rejected = await findSessions({ ...base, status: "Rejected" }, 1);
    return rejected[0] ?? null;
  },

  async start(input: { outletId: unknown; shiftName: string; openingCash: number; openingRemarks?: string | null }) {
    const propertyId = requireProperty();
    const userId = requireUser();
    const outletId = requireOutlet(input.outletId);
    const shiftName = String(input.shiftName ?? "").trim();
    if (!shiftName) throw new AppError("Shift name is required");
    const openingCash = round2(num(input.openingCash));
    if (openingCash < 0) throw new AppError("Opening cash cannot be negative");

    const outlet = await fbModel.get<Row>(fbModel.tables.outlets, outletId);
    if (!outlet) throw new AppError("Outlet not found", 404);
    const { businessDate } = await currentBusinessDate();
    const closed = await fbModel
      .list<Row>(fbModel.tables.outletDayClosings, { filters: { outlet_id: outletId, business_date: businessDate }, limit: 1 })
      .catch(wrapSetupError);
    if (closed.length) {
      throw new AppError(`${outlet.name ?? "This outlet"} is already closed for ${businessDate}. Run Night Audit to move to the next business date.`);
    }

    const base = { property_id: propertyId, outlet_id: outletId, cashier_id: userId };
    if ((await findSessions({ ...base, status: "Open" }, 1))[0]) {
      throw new AppError("You already have an open cashier shift at this outlet");
    }
    if ((await findSessions({ ...base, status: "Rejected" }, 1))[0]) {
      throw new AppError("Correct the rejected closing at this outlet before starting another shift");
    }

    const session = await fbModel.create<SessionRow>(fbModel.tables.cashierSessions, {
      propertyId,
      outletId,
      cashierId: userId,
      shiftName,
      businessDate,
      openedAt: new Date().toISOString(),
      openingCash,
      openingRemarks: input.openingRemarks?.trim() || null,
      status: "Open",
    });
    await audit(session.id, "start", null, "Open", { openingCash, shiftName, outletId }, input.openingRemarks);
    return this.detail(session.id);
  },

  /** Tag a new F&B payment to the cashier's open shift at the payment's outlet. Never throws. */
  async attachTransaction(transaction: Transaction, outletId: string | null | undefined) {
    try {
      if (!outletId || !transaction.id) return;
      if (String(transaction.status ?? "COMPLETED") !== "COMPLETED") return;
      const propertyId = getActivePropertyId();
      const cashierId = transaction.receivedBy || getRequestStore()?.userId;
      if (!propertyId || !cashierId) return;
      const open = await findSessions({ property_id: propertyId, outlet_id: outletId, cashier_id: cashierId, status: "Open" }, 1);
      if (!open[0]) return;
      await supabase
        .from("transactions")
        .update({ [SESSION_COLUMN]: open[0].id })
        .eq("id", transaction.id)
        .is(SESSION_COLUMN, null);
    } catch {
      /* tagging is best effort; the shift claims untagged payments when it is opened */
    }
  },

  /** Pick up F&B payments at this outlet taken by this cashier since the shift opened. */
  async claimUnassigned(session: SessionRow) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, source_id, received_by")
      .eq("property_id", session.propertyId)
      .eq("source_module", "FNB")
      .is(SESSION_COLUMN, null)
      .gte("transaction_date", session.openedAt)
      .in("status", ["COMPLETED", "REFUNDED"]);
    if (error) wrapSetupError(new Error(error.message));
    const rows = ((data ?? []) as Row[]).filter((r) => !r.received_by || String(r.received_by) === session.cashierId);
    if (!rows.length) return;
    const outlets = await outletBySourceId(rows.map((r) => String(r.source_id ?? "")));
    const ids = rows.filter((r) => outlets.get(String(r.source_id ?? "")) === session.outletId).map((r) => String(r.id));
    if (!ids.length) return;
    await supabase.from("transactions").update({ [SESSION_COLUMN]: session.id }).in("id", ids).is(SESSION_COLUMN, null);
  },

  async linesFor(session: SessionRow, saved: FbCashierLine[] = []): Promise<FbCashierLine[]> {
    if (session.status === "Open" || session.status === "Rejected") await this.claimUnassigned(session);

    const { data, error } = await supabase
      .from("transactions")
      .select("payment_method, transaction_type, status, amount")
      .eq(SESSION_COLUMN, session.id);
    if (error) throw new Error(error.message);

    const buckets = new Map<string, { received: number; refunded: number; paidOut: number }>();
    for (const m of METHODS) buckets.set(m.key, { received: 0, refunded: 0, paidOut: 0 });
    for (const row of data ?? []) {
      const status = String(row.status ?? "");
      if (status === "FAILED" || status === "VOIDED" || status === "PENDING") continue;
      const bucket = buckets.get(methodKey(String(row.payment_method ?? "OTHER")))!;
      const amount = num(row.amount);
      const type = String(row.transaction_type ?? "PAYMENT");
      if (type === "REFUND" || status === "REFUNDED") bucket.refunded += amount;
      else if (type === "ADJUSTMENT") bucket.paidOut += amount;
      else if (status === "COMPLETED") bucket.received += amount;
    }

    const savedByMethod = new Map(saved.map((l) => [l.paymentMethod, l]));
    return METHODS.map((m) => {
      const bucket = buckets.get(m.key)!;
      const opening = m.key === "CASH" ? num(session.openingCash) : 0;
      const expected = round2(opening + bucket.received - bucket.refunded - bucket.paidOut);
      const previous = savedByMethod.get(m.label);
      const actual = previous?.actualAmount == null ? null : num(previous.actualAmount);
      return {
        paymentMethod: m.label,
        openingAmount: round2(opening),
        totalReceived: round2(bucket.received),
        totalRefunded: round2(bucket.refunded),
        totalPaidOut: round2(bucket.paidOut),
        expectedAmount: expected,
        actualAmount: actual,
        variance: actual == null ? null : round2(actual - expected),
        remarks: previous?.remarks ?? null,
      };
    });
  },

  async detail(id: string) {
    const session = await loadSession(id);
    const saved = await fbModel.list<FbCashierLine>(fbModel.tables.cashierReconciliations, { filters: { cashier_session_id: id } });
    const lines = await this.linesFor(session, saved);
    const audits = await fbModel.list<Row>(fbModel.tables.cashierSessionAudits, {
      filters: { cashier_session_id: id },
      orderBy: "created_at",
      ascending: true,
    });
    const actorNames = await userNames(audits.map((a) => a.actorId));
    const [named] = await withNames([session]);
    return {
      session: named,
      lines,
      audits: audits.map((a) => ({ ...a, actorName: actorNames.get(String(a.actorId ?? ""))?.name ?? null })),
    };
  },

  async saveClosing(id: string, input: { lines: LineInput[]; closingRemarks?: string | null }) {
    const session = await loadSession(id);
    assertEditable(session);
    if (session.cashierId !== requireUser() && !canApproveCashier()) {
      throw new PermissionError("Only the cashier on this shift can enter the count");
    }
    const computed = await this.linesFor(session);
    const incoming = new Map(input.lines.map((l) => [l.paymentMethod, l]));

    for (const line of computed) {
      const entered = incoming.get(line.paymentMethod);
      const actual = entered ? (entered.actualAmount == null ? null : round2(num(entered.actualAmount))) : line.actualAmount;
      const variance = actual == null ? null : round2(actual - line.expectedAmount);
      const remarks = entered ? entered.remarks?.trim() || null : line.remarks;
      if (actual != null && variance !== 0 && !remarks && !input.closingRemarks?.trim()) {
        throw new AppError(`Enter a remark for the ${line.paymentMethod} variance`);
      }
      const { error } = await supabase.from(fbModel.tables.cashierReconciliations).upsert(
        toSnake({
          cashierSessionId: id,
          paymentMethod: line.paymentMethod,
          openingAmount: line.openingAmount,
          totalReceived: line.totalReceived,
          totalRefunded: line.totalRefunded,
          totalPaidOut: line.totalPaidOut,
          expectedAmount: line.expectedAmount,
          actualAmount: actual,
          variance,
          remarks,
          updatedAt: new Date().toISOString(),
        }),
        { onConflict: "cashier_session_id,payment_method" },
      );
      if (error) throw new Error(error.message);
    }

    const cash = computed.find((l) => l.paymentMethod === "Cash");
    const cashActual = incoming.get("Cash")?.actualAmount;
    await fbModel.update(fbModel.tables.cashierSessions, id, {
      closingCashExpected: cash?.expectedAmount ?? 0,
      closingCashActual: cashActual == null ? null : round2(num(cashActual)),
      cashVariance: cashActual == null ? null : round2(num(cashActual) - num(cash?.expectedAmount)),
      closingRemarks: input.closingRemarks?.trim() || session.closingRemarks || null,
    });
    return this.detail(id);
  },

  async submit(id: string, closingRemarks?: string | null) {
    const current = await this.detail(id);
    const detail = await this.saveClosing(id, {
      lines: current.lines.map((l) => ({ paymentMethod: l.paymentMethod, actualAmount: l.actualAmount, remarks: l.remarks })),
      closingRemarks: closingRemarks ?? (current.session.closingRemarks as string | null),
    });
    if (detail.lines.some((l) => l.actualAmount == null)) {
      throw new AppError("Enter the actual amount for every payment method before submitting");
    }
    const userId = requireUser();
    const from = String(detail.session.status);
    await fbModel.update(fbModel.tables.cashierSessions, id, {
      status: "Pending Approval",
      closedBy: userId,
      closedAt: new Date().toISOString(),
      closingRemarks: closingRemarks?.trim() || detail.session.closingRemarks || null,
    });
    await audit(id, "submit", from, "Pending Approval", detail.lines, closingRemarks);
    return this.detail(id);
  },

  async approve(id: string) {
    if (!canApproveCashier()) throw new PermissionError("Manager approval is required to close this shift");
    const session = await loadSession(id);
    if (session.status !== "Pending Approval") throw new AppError("Only a submitted closing can be approved");
    const userId = requireUser();
    await fbModel.update(fbModel.tables.cashierSessions, id, {
      status: "Closed",
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    });
    await audit(id, "approve", "Pending Approval", "Closed", { approvedBy: userId });
    return this.detail(id);
  },

  async reject(id: string, remarks: string) {
    if (!canApproveCashier()) throw new PermissionError("Manager approval is required to reject this shift");
    const note = remarks.trim();
    if (!note) throw new AppError("A rejection needs an explanation");
    const session = await loadSession(id);
    if (session.status !== "Pending Approval") throw new AppError("Only a submitted closing can be rejected");
    await audit(id, "reject", "Pending Approval", "Rejected", { previousClosingRemarks: session.closingRemarks }, note);
    await fbModel.update(fbModel.tables.cashierSessions, id, {
      status: "Rejected",
      closingRemarks: note,
      approvedBy: null,
      approvedAt: null,
    });
    return this.detail(id);
  },

  async resubmit(id: string, input: { lines: LineInput[]; closingRemarks?: string | null }) {
    const session = await loadSession(id);
    if (session.status !== "Rejected") throw new AppError("Only a rejected closing can be corrected and resubmitted");
    await audit(id, "correct", "Rejected", "Open", { previousStatus: session.status }, input.closingRemarks);
    await fbModel.update(fbModel.tables.cashierSessions, id, { status: "Open" });
    await this.saveClosing(id, input);
    return this.submit(id, input.closingRemarks);
  },
};

import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { foModel } from "../../models/front-office/index.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError, PermissionError } from "../../errors/index.js";
import type { Transaction } from "../../types/transactions.js";

const METHODS = [
  { key: "CASH", label: "Cash" },
  { key: "UPI", label: "UPI" },
  { key: "CARD", label: "Card" },
  { key: "BANK_TRANSFER", label: "Bank Transfer" },
  { key: "CHEQUE", label: "Cheque" },
  { key: "OTHER", label: "Other" },
] as const;

const FO_SOURCES = new Set(["FRONT_OFFICE", "RESERVATION"]);
const COUNTED_STATUS = new Set(["COMPLETED", "REFUNDED"]);

export type CashierLine = {
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
  cashierId: string;
  shiftName: string;
  openedAt: string;
  openingCash: number;
  status: string;
  closingRemarks?: string | null;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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

function canApprove() {
  const store = getRequestStore();
  if (store?.isSuperAdmin) return true;
  const role = String(store?.userRole ?? "").toLowerCase();
  return role === "admin" || role === "administrator" || role === "manager";
}

function methodKey(value: string) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (METHODS.some((method) => method.key === raw)) return raw;
  if (/UPI|GPAY|PHONEPE|PAYTM/.test(raw)) return "UPI";
  if (/CARD|CREDIT|DEBIT/.test(raw)) return "CARD";
  if (/BANK|NEFT|RTGS|IMPS/.test(raw)) return "BANK_TRANSFER";
  if (/CHEQUE|CHECK/.test(raw)) return "CHEQUE";
  if (raw === "CASH") return "CASH";
  return "OTHER";
}

function labelFor(key: string) {
  return METHODS.find((method) => method.key === key)?.label ?? "Other";
}

async function audit(
  sessionId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  snapshot: unknown,
  remarks?: string | null,
) {
  await foModel.create(foModel.tables.cashierSessionAudits, {
    cashierSessionId: sessionId,
    action,
    actorId: getRequestStore()?.userId ?? null,
    fromStatus,
    toStatus,
    snapshot,
    remarks: remarks ?? null,
  });
}

async function loadSession(id: string) {
  const row = await foModel.get<SessionRow>(foModel.tables.cashierSessions, id);
  if (!row) throw new AppError("Cashier session not found", 404);
  return row;
}

function assertEditable(session: SessionRow) {
  if (session.status === "Closed" || session.status === "Pending Approval") {
    throw new AppError("This cashier session is locked");
  }
}

export const CashierSessionService = {
  async list(status?: string) {
    const rows = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
      filters: status ? { status } : undefined,
      orderBy: "opened_at",
      ascending: false,
    });
    return rows;
  },

  async activeForCurrentUser() {
    const propertyId = requireProperty();
    const userId = requireUser();
    const rows = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
      filters: { property_id: propertyId, cashier_id: userId, status: "Open" },
      limit: 1,
    });
    if (rows[0]) return rows[0];
    const rejected = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
      filters: { property_id: propertyId, cashier_id: userId, status: "Rejected" },
      orderBy: "opened_at",
      ascending: false,
      limit: 1,
    });
    return rejected[0] ?? null;
  },

  async start(input: { shiftName: string; openingCash: number; openingRemarks?: string | null }) {
    const propertyId = requireProperty();
    const userId = requireUser();
    const shiftName = String(input.shiftName ?? "").trim();
    if (!shiftName) throw new AppError("Shift name is required");
    const openingCash = round2(num(input.openingCash));
    if (openingCash < 0) throw new AppError("Opening cash cannot be negative");

    const existing = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
      filters: { property_id: propertyId, cashier_id: userId, status: "Open" },
      limit: 1,
    });
    if (existing[0]) {
      throw new AppError("You already have an open cashier shift at this property");
    }
    const rejected = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
      filters: { property_id: propertyId, cashier_id: userId, status: "Rejected" },
      limit: 1,
    });
    if (rejected[0]) {
      throw new AppError("Correct the rejected closing before starting another shift");
    }

    const session = await foModel.create<SessionRow>(foModel.tables.cashierSessions, {
      propertyId,
      cashierId: userId,
      shiftName,
      openedAt: new Date().toISOString(),
      openingCash,
      openingRemarks: input.openingRemarks?.trim() || null,
      status: "Open",
    });
    await audit(session.id, "start", null, "Open", { openingCash, shiftName }, input.openingRemarks);
    return this.detail(session.id);
  },

  async attachTransaction(transaction: Transaction) {
    try {
      const source = String(transaction.sourceModule ?? "");
      if (source && !FO_SOURCES.has(source)) return transaction;
      const status = String(transaction.status ?? "COMPLETED");
      if (!COUNTED_STATUS.has(status)) return transaction;
      const propertyId = getActivePropertyId();
      const cashierId = transaction.receivedBy || getRequestStore()?.userId;
      if (!propertyId || !cashierId || !transaction.id) return transaction;

      const open = await foModel.list<SessionRow>(foModel.tables.cashierSessions, {
        filters: { property_id: propertyId, cashier_id: cashierId, status: "Open" },
        limit: 1,
      });
      const session = open[0];
      if (!session) return transaction;
      const txnAt = new Date(transaction.transactionDate ?? Date.now()).getTime();
      if (Number.isFinite(txnAt) && txnAt < new Date(session.openedAt).getTime()) return transaction;

      const { error } = await supabase
        .from("transactions")
        .update({ cashier_session_id: session.id })
        .eq("id", transaction.id)
        .is("cashier_session_id", null);
      if (error) return transaction;
      return { ...transaction, cashierSessionId: session.id };
    } catch {
      return transaction;
    }
  },

  async claimUnassigned(session: SessionRow) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .is("cashier_session_id", null)
      .gte("transaction_date", session.openedAt)
      .in("source_module", ["FRONT_OFFICE", "RESERVATION"])
      .in("status", ["COMPLETED", "REFUNDED"]);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const receivedBy = row.received_by ? String(row.received_by) : "";
      if (receivedBy && receivedBy !== session.cashierId) continue;
      await supabase
        .from("transactions")
        .update({ cashier_session_id: session.id })
        .eq("id", row.id)
        .is("cashier_session_id", null);
    }
  },

  async linesFor(session: SessionRow, saved: CashierLine[] = []) {
    if (session.status === "Open" || session.status === "Rejected") {
      await this.claimUnassigned(session);
    }

    const { data, error } = await supabase
      .from("transactions")
      .select("payment_method, transaction_type, status, amount")
      .eq("cashier_session_id", session.id);
    if (error) throw new Error(error.message);

    const buckets = new Map<string, { received: number; refunded: number; paidOut: number }>();
    for (const method of METHODS) {
      buckets.set(method.key, { received: 0, refunded: 0, paidOut: 0 });
    }

    for (const row of data ?? []) {
      const status = String(row.status ?? "");
      if (status === "FAILED" || status === "VOIDED" || status === "PENDING") continue;
      const key = methodKey(String(row.payment_method ?? "OTHER"));
      const bucket = buckets.get(key) ?? { received: 0, refunded: 0, paidOut: 0 };
      const amount = num(row.amount);
      const type = String(row.transaction_type ?? "PAYMENT");
      if (type === "REFUND" || status === "REFUNDED") bucket.refunded += amount;
      else if (type === "ADJUSTMENT") bucket.paidOut += amount;
      else if (status === "COMPLETED") bucket.received += amount;
      buckets.set(key, bucket);
    }

    const savedByMethod = new Map(saved.map((line) => [line.paymentMethod, line]));
    return METHODS.map((method) => {
      const bucket = buckets.get(method.key)!;
      const opening = method.key === "CASH" ? num(session.openingCash) : 0;
      const expected = round2(opening + bucket.received - bucket.refunded - bucket.paidOut);
      const previous = savedByMethod.get(method.label);
      const actual = previous?.actualAmount ?? null;
      return {
        paymentMethod: method.label,
        openingAmount: round2(opening),
        totalReceived: round2(bucket.received),
        totalRefunded: round2(bucket.refunded),
        totalPaidOut: round2(bucket.paidOut),
        expectedAmount: expected,
        actualAmount: actual,
        variance: actual == null ? null : round2(actual - expected),
        remarks: previous?.remarks ?? null,
      } satisfies CashierLine;
    });
  },

  async detail(id: string) {
    const session = await loadSession(id);
    const saved = await foModel.list<CashierLine>(foModel.tables.cashierReconciliations, {
      filters: { cashier_session_id: id },
    });
    const lines = await this.linesFor(session, saved);
    const audits = await foModel.list(foModel.tables.cashierSessionAudits, {
      filters: { cashier_session_id: id },
      orderBy: "created_at",
      ascending: true,
    });
    return { session, lines, audits };
  },

  async saveClosing(
    id: string,
    input: { lines: { paymentMethod: string; actualAmount: number | null; remarks?: string | null }[]; closingRemarks?: string | null },
  ) {
    const session = await loadSession(id);
    assertEditable(session);
    if (session.cashierId !== requireUser() && !canApprove()) {
      throw new PermissionError("Only the cashier on this shift can enter the count");
    }
    const computed = await this.linesFor(session);
    const incoming = new Map(input.lines.map((line) => [line.paymentMethod, line]));

    for (const line of computed) {
      const entered = incoming.get(line.paymentMethod);
      const actual = entered
        ? entered.actualAmount == null
          ? null
          : round2(num(entered.actualAmount))
        : line.actualAmount;
      const variance = actual == null ? null : round2(actual - line.expectedAmount);
      const remarks = entered ? entered.remarks?.trim() || null : line.remarks;
      if (actual != null && variance !== 0 && !remarks && !input.closingRemarks?.trim()) {
        throw new AppError(`Enter a remark for the ${line.paymentMethod} variance`);
      }
      const payload = toSnake({
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
      });
      const { error } = await supabase
        .from("fo_cashier_reconciliations")
        .upsert(payload, { onConflict: "cashier_session_id,payment_method" });
      if (error) throw new Error(error.message);
    }

    const cash = computed.find((line) => line.paymentMethod === "Cash");
    const cashActual = incoming.get("Cash")?.actualAmount;
    await foModel.update(foModel.tables.cashierSessions, id, {
      closingCashExpected: cash?.expectedAmount ?? 0,
      closingCashActual: cashActual == null ? null : round2(num(cashActual)),
      cashVariance:
        cashActual == null ? null : round2(num(cashActual) - num(cash?.expectedAmount)),
      closingRemarks: input.closingRemarks?.trim() || session.closingRemarks || null,
    });
    return this.detail(id);
  },

  async submit(id: string, closingRemarks?: string | null) {
    const current = await this.detail(id);
    const detail = await this.saveClosing(id, {
      lines: current.lines.map((line) => ({
        paymentMethod: line.paymentMethod,
        actualAmount: line.actualAmount,
        remarks: line.remarks,
      })),
      closingRemarks: closingRemarks ?? current.session.closingRemarks,
    });
    const missing = detail.lines.filter((line) => line.actualAmount == null);
    if (missing.length) {
      throw new AppError("Enter the actual amount for every payment method before submitting");
    }
    const unexplained = detail.lines.filter(
      (line) => line.variance && line.variance !== 0 && !line.remarks && !closingRemarks?.trim() && !detail.session.closingRemarks,
    );
    if (unexplained.length) {
      throw new AppError("A non-zero variance needs a remark before submission");
    }
    const userId = requireUser();
    await foModel.update(foModel.tables.cashierSessions, id, {
      status: "Pending Approval",
      closedBy: userId,
      closedAt: new Date().toISOString(),
      closingRemarks: closingRemarks?.trim() || detail.session.closingRemarks || null,
    });
    await audit(id, "submit", detail.session.status, "Pending Approval", detail.lines, closingRemarks);
    return this.detail(id);
  },

  async approve(id: string) {
    if (!canApprove()) throw new PermissionError("Manager approval is required to close this shift");
    const session = await loadSession(id);
    if (session.status !== "Pending Approval") {
      throw new AppError("Only a submitted closing can be approved");
    }
    const userId = requireUser();
    await foModel.update(foModel.tables.cashierSessions, id, {
      status: "Closed",
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    });
    await audit(id, "approve", "Pending Approval", "Closed", { approvedBy: userId });
    return this.detail(id);
  },

  async reject(id: string, remarks: string) {
    if (!canApprove()) throw new PermissionError("Manager approval is required to reject this shift");
    const note = remarks.trim();
    if (!note) throw new AppError("A rejection needs an explanation");
    const session = await loadSession(id);
    if (session.status !== "Pending Approval") {
      throw new AppError("Only a submitted closing can be rejected");
    }
    await audit(id, "reject", "Pending Approval", "Rejected", { previousClosingRemarks: session.closingRemarks }, note);
    await foModel.update(foModel.tables.cashierSessions, id, {
      status: "Rejected",
      closingRemarks: note,
      approvedBy: null,
      approvedAt: null,
    });
    return this.detail(id);
  },

  async resubmit(
    id: string,
    input: { lines: { paymentMethod: string; actualAmount: number | null; remarks?: string | null }[]; closingRemarks?: string | null },
  ) {
    const session = await loadSession(id);
    if (session.status !== "Rejected") {
      throw new AppError("Only a rejected closing can be corrected and resubmitted");
    }
    await audit(id, "correct", "Rejected", "Open", { previousStatus: session.status }, input.closingRemarks);
    await foModel.update(foModel.tables.cashierSessions, id, { status: "Open" });
    await this.saveClosing(id, input);
    return this.submit(id, input.closingRemarks);
  },
};

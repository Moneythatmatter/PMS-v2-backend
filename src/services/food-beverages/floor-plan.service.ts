import { fbModel } from "../../models/food-beverages/index.js";
import { PosService } from "./pos.service.js";

type Row = Record<string, unknown>;

export type TableDisplayState =
  | "BLANK"
  | "RUNNING"
  | "RUNNING_KOT"
  | "PRINTED"
  | "PAID";

/** Legacy UI status keys (ops.ts tableStatusStyles). */
export type LegacyTableStatus =
  | "Available"
  | "Reserved"
  | "Occupied"
  | "Billing"
  | "Dirty";

const DISPLAY_TO_LEGACY: Record<TableDisplayState, LegacyTableStatus> = {
  BLANK: "Available",
  RUNNING: "Reserved",
  RUNNING_KOT: "Occupied",
  PRINTED: "Billing",
  PAID: "Dirty",
};

function sessionDurationMin(openedAt: unknown) {
  if (!openedAt) return 0;
  const start = new Date(String(openedAt)).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 60_000));
}

function deriveDisplayState(input: {
  hasOpenSession: boolean;
  hasOpenOrder: boolean;
  hasActiveKot: boolean;
  billPrinted: boolean;
  paymentStatus: string;
  housekeeping: string;
}): TableDisplayState {
  const ps = String(input.paymentStatus ?? "").toUpperCase();
  const hk = String(input.housekeeping ?? "CLEAN").toUpperCase();

  if (ps === "PAID") {
    return hk === "CLEAN" ? "BLANK" : "PAID";
  }
  if (input.billPrinted && ps !== "PAID") return "PRINTED";
  if (input.hasActiveKot) return "RUNNING_KOT";
  if (input.hasOpenSession || input.hasOpenOrder) return "RUNNING";
  return "BLANK";
}

async function loadContextForTable(table: Row) {
  const tableId = String(table.id);
  const sessions = await fbModel.list<Row>(fbModel.tables.tableSessions, {
    filters: { live_table_id: tableId, status: "OPEN" },
    limit: 1,
  });
  const session = sessions[0] ?? null;

  let order: Row | null = null;
  let items: Row[] = [];
  let kots: Row[] = [];
  let bill: Row | null = null;

  if (session) {
    const orders = await fbModel.list<Row>(fbModel.tables.orders, {
      filters: { session_id: String(session.id), lifecycle_status: "OPEN" },
      orderBy: "created_at",
      ascending: false,
      limit: 1,
    });
    order = orders[0] ?? null;
  }

  if (!order) {
    const outletId = String(table.outletId ?? "");
    const tableNo = String(table.tableNo ?? "").trim();
    if (outletId && tableNo) {
      const orders = await fbModel.list<Row>(fbModel.tables.orders, {
        filters: { outlet_id: outletId, lifecycle_status: "OPEN" },
        orderBy: "created_at",
        ascending: false,
      });
      order =
        orders.find(
          (o) =>
            String(o.type) === "Dine In" &&
            String(o.ref ?? "").trim().toLowerCase() === tableNo.toLowerCase(),
        ) ?? null;
    }
  }

  if (order?.id) {
    const orderId = String(order.id);
    [items, kots] = await Promise.all([
      fbModel.list<Row>(fbModel.tables.orderItems, { filters: { order_id: orderId } }),
      fbModel.list<Row>(fbModel.tables.kotTickets, { filters: { order_id: orderId } }),
    ]);
    const bills = await fbModel.list<Row>(fbModel.tables.bills, {
      filters: { order_id: orderId },
      orderBy: "created_at",
      ascending: false,
      limit: 1,
    });
    bill = bills[0] ?? null;
  }

  const hasActiveKot = kots.some((k) =>
    PosService.ACTIVE_KOT.has(String(k.status ?? "").toUpperCase()),
  );

  const paymentStatus = bill
    ? String(bill.paymentStatus ?? "UNPAID")
    : "UNPAID";

  const billPrinted = Boolean(bill?.billPrintedAt);

  const displayState = deriveDisplayState({
    hasOpenSession: Boolean(session),
    hasOpenOrder: Boolean(order),
    hasActiveKot,
    billPrinted,
    paymentStatus,
    housekeeping: String(table.housekeeping ?? "CLEAN"),
  });

  const legacyStatus = DISPLAY_TO_LEGACY[displayState];
  const checkAmount = bill
    ? Number(bill.total ?? 0)
    : order
      ? Number(order.amount ?? 0)
      : Number(table.checkAmount ?? 0);

  return {
    ...table,
    displayState,
    status: legacyStatus,
    session,
    order,
    bill,
    kotCount: kots.length,
    guest:
      session?.guestName ??
      order?.guest ??
      table.guest ??
      "—",
    server:
      session?.server ??
      order?.server ??
      table.server ??
      "—",
    covers: Number(session?.pax ?? order?.pax ?? table.covers ?? 0),
    durationMin: session
      ? sessionDurationMin(session.openedAt)
      : Number(table.durationMin ?? 0),
    checkAmount,
    openOrderId: order?.id ? String(order.id) : null,
    openSessionId: session?.id ? String(session.id) : null,
    openBillId: bill?.id ? String(bill.id) : null,
  };
}

export const FloorPlanService = {
  deriveDisplayState,
  DISPLAY_TO_LEGACY,

  async listFloorPlan(outletId?: string) {
    try {
      const tables = await fbModel.list<Row>(fbModel.tables.liveTables, {
        filters: outletId ? { outlet_id: outletId } : undefined,
        orderBy: "table_no",
      });
      return Promise.all(tables.map((t) => loadContextForTable(t)));
    } catch {
      const tables = await fbModel.list<Row>(fbModel.tables.liveTables, {
        filters: outletId ? { outlet_id: outletId } : undefined,
        orderBy: "table_no",
      });
      return tables.map((t) => ({
        ...t,
        displayState: mapLegacyStatusToDisplay(String(t.status ?? "Available")),
        status: String(t.status ?? "Available"),
      }));
    }
  },

  async getTableFloorPlan(tableId: string) {
    try {
      const table = await fbModel.get<Row>(fbModel.tables.liveTables, tableId);
      if (!table) return null;
      return loadContextForTable(table);
    } catch {
      const table = await fbModel.get<Row>(fbModel.tables.liveTables, tableId);
      if (!table) return null;
      return {
        ...table,
        displayState: mapLegacyStatusToDisplay(String(table.status ?? "Available")),
        status: String(table.status ?? "Available"),
      };
    }
  },
};

function mapLegacyStatusToDisplay(status: string): TableDisplayState {
  const s = status.toLowerCase();
  if (s === "dirty") return "PAID";
  if (s === "billing") return "PRINTED";
  if (s === "occupied") return "RUNNING_KOT";
  if (s === "reserved") return "RUNNING";
  return "BLANK";
}

export { loadContextForTable };

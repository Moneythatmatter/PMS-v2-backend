import { fbModel } from "../../models/food-beverages/index.js";
import {
  isRoomChargePayment,
  isRoomChargeSettledOrder,
  settleRoomChargeViaRpc,
  syncRoomServiceAfterCancellationViaRpc,
} from "../shared/fnb-folio-sync.service.js";
import { TransactionService } from "../shared/transaction.service.js";
import { AppError, ConflictError } from "../../errors/index.js";
import type { PaymentMethod } from "../../types/transactions.js";
import {
  groupsForMenuItems,
  resolveSelections,
  type ModifierGroup,
  type SelectedModifier,
} from "../../models/food-beverages/modifiers.js";
import { consumeRecipesForOrder } from "./recipe-consumption.service.js";
import { TableReservationService } from "./table-reservations.service.js";
import { FbCashierSessionService } from "./fb-cashier-session.service.js";
import { quoteBillingPoint } from "../accounts/tax-resolver.js";
import { localTodayIso } from "../front-office/room-hk-status.js";

type Row = Record<string, unknown>;

export type PosLineInput = {
  menuItemId?: string;
  name: string;
  qty: number;
  /** Base price of the menu item; modifier prices are added server-side. */
  unitPrice: number;
  note?: string;
  modifierIds?: string[];
};

type PricedLine = PosLineInput & {
  basePrice: number;
  modifierTotal: number;
  modifiers: SelectedModifier[];
};

export type SendKotInput = {
  outletId: string;
  type: string;
  ref?: string;
  liveTableId?: string;
  guest?: string;
  guestId?: string;
  guestNo?: string;
  reservationId?: string;
  pax?: number;
  server?: string;
  lines: PosLineInput[];
  print?: boolean;
  /** Reuse existing open order (add-on KOT) */
  orderId?: string;
  /** Staff chose to seat someone else on a table held for this reservation. */
  overrideReservation?: { reservationId: string; reason?: string };
};

const ACTIVE_KOT = new Set(["PENDING", "PREPARING", "READY"]);
const CANCELLABLE_KOT = new Set(["PENDING", "PREPARING", "READY"]);
const KITCHEN_TO_KOT: Record<string, string> = {
  Pending: "PENDING",
  Preparing: "PREPARING",
  Ready: "READY",
  Served: "SERVED",
};

const KOT_TO_KITCHEN: Record<string, string> = {
  PENDING: "Pending",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Rejected",
};

const KITCHEN_PENDING_KOT = new Set(["PENDING", "PREPARING"]);

async function assertKitchenDone(orderId: string) {
  const kots = await fbModel.list<Row>(fbModel.tables.kotTickets, {
    filters: { order_id: orderId },
  });
  const pending = kots.filter((k) =>
    KITCHEN_PENDING_KOT.has(String(k.status ?? "").toUpperCase()),
  );
  if (!pending.length) return;
  const labels = pending.map((k) => {
    const no = String(k.kotNumber ?? k.id);
    return /^kot/i.test(no) ? no : `KOT-${no}`;
  });
  throw new AppError(
    `Food is still being prepared (${labels.join(", ")}). Bill once the kitchen marks it ready.`,
    409,
  );
}

function kotUiStatus(raw: string) {
  return KOT_TO_KITCHEN[String(raw ?? "").toUpperCase()] ?? "Pending";
}

function nowIso() {
  return new Date().toISOString();
}

function nowLabel() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isDineInTableRef(ref: unknown) {
  const value = String(ref ?? "").trim();
  return value.length > 0 && value.toLowerCase() !== "walk-in";
}

function sumLines(lines: PosLineInput[]) {
  return lines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0);
}

async function priceLines(lines: PosLineInput[]): Promise<PricedLine[]> {
  const anyModifiers = lines.some((l) => (l.modifierIds?.length ?? 0) > 0);
  let groupsByItem = new Map<string, ModifierGroup[]>();
  try {
    groupsByItem = await groupsForMenuItems(lines.map((l) => l.menuItemId ?? ""));
  } catch (e) {
    // Before fb-modifiers.sql is applied the link table doesn't exist; plain items must still go through.
    if (anyModifiers) throw e;
  }
  return lines.map((line) => {
    const basePrice = Number(line.unitPrice) || 0;
    const groups = line.menuItemId ? (groupsByItem.get(line.menuItemId) ?? []) : [];
    if (groups.length === 0) {
      if (line.modifierIds?.length) {
        throw new AppError(`${line.name}: modifiers are not available for this item`, 400);
      }
      return { ...line, unitPrice: basePrice, basePrice, modifierTotal: 0, modifiers: [] };
    }
    const { selected, total } = resolveSelections(line.name, groups, line.modifierIds ?? []);
    return { ...line, unitPrice: basePrice + total, basePrice, modifierTotal: total, modifiers: selected };
  });
}

export function modifierNames(item: Row) {
  const list = Array.isArray(item.modifiers) ? (item.modifiers as Row[]) : [];
  return list.map((m) => String(m.name ?? "")).filter(Boolean);
}

function syncLegacyOrderLines(items: Row[]) {
  return items
    .filter((i) => String(i.status ?? "ACTIVE") === "ACTIVE")
    .map((i) => {
      const modifiers = modifierNames(i);
      return {
        name: String(i.name ?? ""),
        qty: Number(i.quantity ?? 1),
        ...(modifiers.length ? { modifiers } : {}),
        ...(i.note ? { note: String(i.note) } : {}),
      };
    });
}

async function getOrderItems(orderId: string) {
  return fbModel.list<Row>(fbModel.tables.orderItems, {
    filters: { order_id: orderId },
    orderBy: "created_at",
  });
}

async function recomputeOrderAmount(orderId: string) {
  const items = await getOrderItems(orderId);
  const active = items.filter((i) => String(i.status) === "ACTIVE");
  const amount = active.reduce((s, i) => s + Number(i.lineTotal ?? 0), 0);
  const lines = syncLegacyOrderLines(active);
  await fbModel.update(fbModel.tables.orders, orderId, { amount, lines });
  return amount;
}

function isBillableOrderItem(status: unknown) {
  return String(status ?? "ACTIVE").toUpperCase() === "ACTIVE";
}

async function assertBillAdjustable(orderId: string) {
  const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
  const bills = await fbModel.list<Row>(fbModel.tables.bills, {
    filters: { order_id: orderId },
    limit: 1,
  });
  const bill = bills[0];
  if (!bill) return;
  if (isRoomChargeSettledOrder(order)) return;
  const paymentStatus = String(bill.paymentStatus ?? "UNPAID").toUpperCase();
  if (paymentStatus === "PAID" || paymentStatus === "PARTIALLY_PAID") {
    throw new AppError(
      "Cannot cancel items on a paid or partially paid bill. Process a refund or adjustment first.",
      400,
    );
  }
}

async function voidOrderItemQuantity(orderItemId: string, voidQty: number) {
  const orderItem = await fbModel.get<Row>(fbModel.tables.orderItems, orderItemId);
  if (!orderItem || !isBillableOrderItem(orderItem.status)) return;

  const currentQty = Number(orderItem.quantity ?? 1);
  const unitPrice = Number(orderItem.unitPrice ?? 0);
  const qtyToVoid = Math.max(0, Math.min(voidQty, currentQty));

  if (qtyToVoid <= 0) return;

  if (qtyToVoid >= currentQty) {
    await fbModel.update(fbModel.tables.orderItems, orderItemId, {
      status: "CANCELLED",
      lineTotal: 0,
    });
    return;
  }

  const newQty = currentQty - qtyToVoid;
  await fbModel.update(fbModel.tables.orderItems, orderItemId, {
    quantity: newQty,
    lineTotal: newQty * unitPrice,
  });
}

async function syncBillAfterCancellation(orderId: string) {
  const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
  const bills = await fbModel.list<Row>(fbModel.tables.bills, {
    filters: { order_id: orderId },
    limit: 1,
  });
  const bill = bills[0];
  const amount = await recomputeOrderAmount(orderId);

  if (order && bill && isRoomChargeSettledOrder(order)) {
    // Bills settled before F&B tax was mapped stay untaxed.
    const split = Number(bill.tax ?? 0) > 0
      ? await fbBillAmounts(orderId, amount, order)
      : { subtotal: amount, tax: 0 };
    const tax = split.tax;
    const discount = Number(bill.discount ?? 0);
    const total = roundedBillTotal(split.subtotal, tax, discount);
    await syncRoomServiceAfterCancellationViaRpc({
      billId: String(bill.id),
      orderId,
      newSubtotal: split.subtotal,
      newTax: tax,
      newDiscount: discount,
      newTotal: total,
      reversalNotes: null,
    });
    return amount;
  }

  await assertBillAdjustable(orderId);
  await ensureBillForOrder(orderId, amount);
  return amount;
}

async function syncOrderLifecycleFromItems(orderId: string) {
  const items = await getOrderItems(orderId);
  const hasBillable = items.some((i) => isBillableOrderItem(i.status));
  const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
  if (!order) return;

  const lifecycle = String(order.lifecycleStatus ?? "OPEN").toUpperCase();
  if (lifecycle === "CLOSED") return;

  if (hasBillable) {
    if (lifecycle === "CANCELLED") {
      await fbModel.update(fbModel.tables.orders, orderId, {
        lifecycleStatus: "OPEN",
      });
    }
    return;
  }

  await fbModel.update(fbModel.tables.orders, orderId, {
    lifecycleStatus: "CANCELLED",
    status: "Cancelled",
  });
}

async function maybeCancelKotTicket(kotId: string) {
  const kotItems = await fbModel.list<Row>(fbModel.tables.kotItems, {
    filters: { kot_id: kotId },
  });
  if (!kotItems.length) return;

  const allCancelled = kotItems.every(
    (item) => String(item.status).toUpperCase() === "CANCELLED",
  );
  if (!allCancelled) return;

  await fbModel.update(fbModel.tables.kotTickets, kotId, {
    status: "CANCELLED",
    updatedAt: nowIso(),
  });
}

/**
 * Split an order's item total into bill subtotal + tax using the F&B billing point.
 * Unmapped billing points carry no tax; a mapped point with incomplete tax setup blocks billing.
 */
async function fbBillAmounts(orderId: string, gross: number, order?: Row | null) {
  const o = order ?? (await fbModel.get<Row>(fbModel.tables.orders, orderId));
  const point = String(o?.type ?? "").trim() === "Room Service" ? "FB_ROOM_SERVICE" : "FB_RESTAURANT_BILL";
  const result = await quoteBillingPoint(point, gross, localTodayIso());
  if (!result.configured || !(gross > 0)) return { subtotal: gross, tax: 0 };
  if (!result.quote.ok) throw new AppError(`F&B tax setup incomplete — ${result.quote.issue}`, 409);
  return { subtotal: result.quote.taxableAmount, tax: result.quote.taxAmount };
}

type BillTaxLine = { code: string; name: string; type: string; rate: number; fixed: boolean; amount: number };

/**
 * Per-tax split of a bill's stored tax (e.g. CGST 2.5% + SGST 2.5%), from the F&B billing point.
 * Line amounts are scaled so they always add up to the tax frozen on the bill.
 */
export async function billTaxBreakdown(order: Row, bill: Row | null | undefined) {
  const tax = Number(bill?.tax ?? 0);
  if (!bill || !(tax > 0)) return { included: false, lines: [] as BillTaxLine[] };
  const point = String(order.type ?? "").trim() === "Room Service" ? "FB_ROOM_SERVICE" : "FB_RESTAURANT_BILL";
  const subtotal = Number(bill.subtotal ?? 0);
  const date = String(bill.createdAt ?? "").slice(0, 10) || localTodayIso();
  try {
    let result = await quoteBillingPoint(point, subtotal, date);
    if (result.configured && result.resolution.priceIncludesTax) {
      result = await quoteBillingPoint(point, subtotal + tax, date);
    }
    if (!result.configured || !result.quote.ok || !result.quote.lines.length) {
      return { included: false, lines: [{ code: "TAX", name: "Tax", type: "", rate: 0, fixed: false, amount: tax }] };
    }
    const raw = result.quote.lines;
    const rawSum = raw.reduce((s, l) => s + l.amount, 0) || 1;
    let allocated = 0;
    const lines = raw.map((l, idx) => {
      const amount =
        idx === raw.length - 1
          ? Math.round((tax - allocated) * 100) / 100
          : Math.round(((l.amount / rawSum) * tax) * 100) / 100;
      allocated += amount;
      return {
        code: l.taxCode,
        name: l.taxName || l.taxCode,
        type: l.taxType,
        rate: l.rate,
        fixed: l.calculationType === "Fixed",
        amount,
      };
    });
    return { included: result.resolution.priceIncludesTax, lines };
  } catch {
    return { included: false, lines: [{ code: "TAX", name: "Tax", type: "", rate: 0, fixed: false, amount: tax }] };
  }
}

async function billPayments(billId: string) {
  const txs = await TransactionService.list({ sourceModule: "FNB", sourceId: billId });
  return txs
    .filter((t) => String(t.status).toUpperCase() === "COMPLETED")
    .filter((t) => String(t.transactionType).toUpperCase() === "PAYMENT")
    .map((t) => ({
      id: String(t.id),
      method: String(t.paymentMethod ?? ""),
      amount: Number(t.amount ?? 0),
      at: String(t.createdAt ?? ""),
    }));
}

/** Bills are payable in whole rupees; the paise difference posts to the Round Off ledger. */
function roundedBillTotal(subtotal: number, tax: number, discount = 0) {
  return Math.max(0, Math.round(subtotal + tax - discount));
}

/** Unpaid bills saved before rupee rounding carry paise; round them before they are shown or paid. */
async function withRoundedTotal(bill: Row): Promise<Row>;
async function withRoundedTotal(bill: Row | null | undefined): Promise<Row | null | undefined>;
async function withRoundedTotal(bill: Row | null | undefined) {
  if (!bill?.id) return bill;
  if (String(bill.paymentStatus ?? "UNPAID").toUpperCase() !== "UNPAID") return bill;
  const total = roundedBillTotal(Number(bill.subtotal ?? 0), Number(bill.tax ?? 0), Number(bill.discount ?? 0));
  if (Number(bill.total ?? 0) === total) return bill;
  return fbModel.update<Row>(fbModel.tables.bills, String(bill.id), { total, updatedAt: nowIso() });
}

async function ensureBillForOrder(orderId: string, itemsTotal: number) {
  const { subtotal, tax } = await fbBillAmounts(orderId, itemsTotal);
  const existing = await fbModel.list<Row>(fbModel.tables.bills, {
    filters: { order_id: orderId },
    limit: 1,
  });
  if (existing[0]?.id) {
    const bill = existing[0];
    const paymentStatus = String(bill.paymentStatus ?? "UNPAID").toUpperCase();
    if (paymentStatus === "PAID" || paymentStatus === "PARTIALLY_PAID") return bill;
    return fbModel.update<Row>(fbModel.tables.bills, String(bill.id), {
      subtotal,
      tax,
      discount: Number(bill.discount ?? 0),
      total: roundedBillTotal(subtotal, tax, Number(bill.discount ?? 0)),
      updatedAt: nowIso(),
    });
  }

  return fbModel.create<Row>(fbModel.tables.bills, {
    id: fbModel.newId("BL"),
    orderId,
    status: "OPEN",
    paymentStatus: "UNPAID",
    subtotal,
    tax,
    discount: 0,
    total: roundedBillTotal(subtotal, tax),
  });
}

async function findLiveTable(outletId: string, tableNo: string) {
  const normalized = tableNo.trim().toLowerCase();
  if (!outletId || !normalized) return null;
  const rows = await fbModel.list<Row>(fbModel.tables.liveTables, {
    filters: { outlet_id: outletId },
  });
  return (
    rows.find((t) => String(t.tableNo ?? "").toLowerCase() === normalized) ??
    null
  );
}

async function getOpenSessionForTable(liveTableId: string) {
  const rows = await fbModel.list<Row>(fbModel.tables.tableSessions, {
    filters: { live_table_id: liveTableId, status: "OPEN" },
    limit: 1,
  });
  return rows[0] ?? null;
}

async function getOpenOrderForSession(sessionId: string) {
  const rows = await fbModel.list<Row>(fbModel.tables.orders, {
    filters: { session_id: sessionId, lifecycle_status: "OPEN" },
    orderBy: "created_at",
    ascending: false,
    limit: 1,
  });
  return rows[0] ?? null;
}

async function createSession(input: {
  liveTableId: string;
  outletId: string;
  guest?: string;
  guestId?: string;
  guestNo?: string;
  reservationId?: string;
  pax?: number;
  server?: string;
  overrideReservationId?: string;
  overrideReason?: string;
}) {
  return fbModel.create<Row>(fbModel.tables.tableSessions, {
    ...(input.overrideReservationId
      ? { overrideReservationId: input.overrideReservationId, overrideReason: input.overrideReason ?? "" }
      : {}),
    id: fbModel.newId("TS"),
    liveTableId: input.liveTableId,
    outletId: input.outletId,
    guestName: input.guest ?? "Walk-in",
    guestId: input.guestId ?? null,
    guestNo: input.guestNo ?? null,
    reservationId: input.reservationId ?? null,
    pax: input.pax && input.pax > 0 ? input.pax : 2,
    server: input.server ?? "",
    status: "OPEN",
    openedAt: nowIso(),
  });
}

async function createOrderRecord(input: {
  outletId: string;
  type: string;
  ref: string;
  sessionId?: string | null;
  guest?: string;
  guestId?: string;
  guestNo?: string;
  reservationId?: string;
  pax?: number;
  server?: string;
}) {
  return fbModel.create<Row>(fbModel.tables.orders, {
    id: fbModel.newId("OR"),
    outletId: input.outletId,
    type: input.type,
    ref: input.ref,
    sessionId: input.sessionId ?? null,
    guest: input.guest ?? "Walk-in",
    guestId: input.guestId ?? null,
    guestNo: input.guestNo ?? null,
    reservationId: input.reservationId ?? null,
    pax: input.pax ?? null,
    server: input.server ?? "",
    lines: [],
    amount: 0,
    status: "Pending",
    lifecycleStatus: "OPEN",
    placedAt: nowLabel(),
  });
}

export const PosService = {
  async sendKot(input: SendKotInput) {
    if (!input.lines.length) {
      throw new AppError("Add at least one item", 400);
    }

    // Each call appends new order_items and creates a new fb_kot_tickets row.
    // When input.orderId is set, items stay on the same open order (add-on KOT).

    const pricedLines = await priceLines(input.lines);

    const type = input.type || "Dine In";
    const ref =
      input.ref?.trim() ||
      (type === "Dine In"
        ? "Walk-in"
        : type === "Takeaway"
          ? "Counter"
          : "Delivery");

    let order: Row | null = null;
    let session: Row | null = null;
    let liveTable: Row | null = null;

    if (input.orderId) {
      order = await fbModel.get<Row>(fbModel.tables.orders, input.orderId);
      if (!order) throw new AppError("Order not found", 404);
      if (String(order.lifecycleStatus) !== "OPEN") {
        throw new AppError("Order is not open", 400);
      }
      if (order.sessionId) {
        session = await fbModel.get(fbModel.tables.tableSessions, String(order.sessionId));
      }
    } else if (type === "Dine In" && (input.liveTableId || isDineInTableRef(ref))) {
      liveTable = input.liveTableId
        ? await fbModel.get<Row>(fbModel.tables.liveTables, input.liveTableId)
        : await findLiveTable(input.outletId, ref);

      if (liveTable?.id) {
        session = await getOpenSessionForTable(String(liveTable.id));
        if (!session) {
          const tableNo = String(liveTable.tableNo ?? ref);
          const holding = await TableReservationService.activeBlockingReservation(
            String(liveTable.outletId ?? input.outletId),
            tableNo,
          ).catch((e) => {
            console.warn("[pos] reservation check skipped:", e);
            return null;
          });
          const overridden = Boolean(holding && input.overrideReservation?.reservationId === holding.id);
          if (holding && !overridden) {
            throw new ConflictError(TableReservationService.blockingMessage(holding, tableNo));
          }
          session = await createSession({
            liveTableId: String(liveTable.id),
            outletId: input.outletId,
            guest: input.guest,
            guestId: input.guestId,
            guestNo: input.guestNo,
            reservationId: input.reservationId,
            pax: input.pax,
            server: input.server,
            ...(overridden && holding
              ? {
                  overrideReservationId: holding.id,
                  overrideReason: input.overrideReservation?.reason?.trim() || "Staff override",
                }
              : {}),
          });
        }
        order = await getOpenOrderForSession(String(session.id));
      }
    }

    if (!order) {
      order = await createOrderRecord({
        outletId: input.outletId,
        type,
        ref,
        sessionId: session?.id ? String(session.id) : null,
        guest: input.guest,
        guestId: input.guestId,
        guestNo: input.guestNo,
        reservationId: input.reservationId,
        pax: input.pax,
        server: input.server,
      });
    } else {
      const patch: Record<string, unknown> = {};
      if (input.guest) patch.guest = input.guest;
      if (input.server) patch.server = input.server;
      if (input.pax) patch.pax = input.pax;
      if (Object.keys(patch).length) {
        order = await fbModel.update(fbModel.tables.orders, String(order.id), patch);
      }
    }

    if (!order?.id) throw new AppError("Failed to create or load order", 500);

    const orderId = String(order.id);
    const createdItems: Row[] = [];

    for (const line of pricedLines) {
      const qty = Math.max(1, Number(line.qty) || 1);
      const unitPrice = line.unitPrice;
      const item = await fbModel.create<Row>(fbModel.tables.orderItems, {
        id: fbModel.newId("OI"),
        orderId,
        menuItemId: line.menuItemId ?? null,
        name: line.name,
        quantity: qty,
        basePrice: line.basePrice,
        modifierTotal: line.modifierTotal,
        modifiers: line.modifiers,
        unitPrice,
        lineTotal: qty * unitPrice,
        note: line.note ?? null,
        status: "ACTIVE",
      });
      createdItems.push(item);
    }

    const kot = await fbModel.create<Row>(fbModel.tables.kotTickets, {
      id: fbModel.newId("KT"),
      orderId,
      status: "PREPARING",
      printedAt: input.print ? nowIso() : null,
      updatedAt: nowIso(),
    });

    for (const item of createdItems) {
      await fbModel.create(fbModel.tables.kotItems, {
        id: fbModel.newId("KI"),
        kotId: kot.id,
        orderItemId: item.id,
        quantity: item.quantity,
        status: "PREPARING",
      });
    }

    const amount = await recomputeOrderAmount(orderId);
    await ensureBillForOrder(orderId, amount);

    await this.syncOrderStatusFromKots(orderId);

    const fullOrder = await fbModel.get<Row>(fbModel.tables.orders, orderId);
    const kotRows = await fbModel.list(fbModel.tables.kotTickets, {
      filters: { order_id: orderId },
    });

    return {
      order: fullOrder,
      session,
      kot,
      kots: kotRows,
      amount,
    };
  },

  async getOrderWithDetails(orderId: string) {
    const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
    if (!order) return null;

    const [items, kots, bills] = await Promise.all([
      getOrderItems(orderId),
      fbModel.list<Row>(fbModel.tables.kotTickets, {
        filters: { order_id: orderId },
        orderBy: "created_at",
      }),
      fbModel.list<Row>(fbModel.tables.bills, {
        filters: { order_id: orderId },
        orderBy: "created_at",
      }),
    ]);

    const kotsWithItems = await Promise.all(
      kots.map(async (k) => ({
        ...k,
        items: await fbModel.list(fbModel.tables.kotItems, {
          filters: { kot_id: String(k.id) },
        }),
      })),
    );

    if (bills[0]) bills[0] = await withRoundedTotal(bills[0]);
    const primaryBill = bills[0];
    const [taxSummary, payments] = await Promise.all([
      billTaxBreakdown(order, primaryBill),
      primaryBill?.id ? billPayments(String(primaryBill.id)) : Promise.resolve([]),
    ]);
    const paidAmount = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;

    return { order, items, kots: kotsWithItems, bills, taxSummary, payments, paidAmount };
  },

  async getOpenOrderForTable(liveTableId: string) {
    const session = await getOpenSessionForTable(liveTableId);
    if (!session) return null;
    const order = await getOpenOrderForSession(String(session.id));
    if (!order) return { session, order: null };
    const details = await this.getOrderWithDetails(String(order.id));
    return { session, ...details };
  },

  async printBill(billId: string) {
    const bill = await fbModel.get<Row>(fbModel.tables.bills, billId);
    if (!bill) throw new AppError("Bill not found", 404);
    if (bill.orderId) await assertKitchenDone(String(bill.orderId));

    const unpaid = String(bill.paymentStatus ?? "UNPAID").toUpperCase() === "UNPAID";
    return fbModel.update(fbModel.tables.bills, billId, {
      billPrintedAt: nowIso(),
      updatedAt: nowIso(),
      ...(unpaid
        ? {
            total: roundedBillTotal(
              Number(bill.subtotal ?? 0),
              Number(bill.tax ?? 0),
              Number(bill.discount ?? 0),
            ),
          }
        : {}),
    });
  },

  async printBillForOrder(orderId: string) {
    const bills = await fbModel.list<Row>(fbModel.tables.bills, {
      filters: { order_id: orderId },
      limit: 1,
    });
    let bill = bills[0];
    if (!bill) {
      const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
      if (!order) throw new AppError("Order not found", 404);
      bill = await ensureBillForOrder(orderId, Number(order.amount ?? 0));
    }
    return this.printBill(String(bill.id));
  },

  async syncBillPaymentStatus(billId: string) {
    const bill = await fbModel.get<Row>(fbModel.tables.bills, billId);
    if (!bill) throw new AppError("Bill not found", 404);

    const txs = await TransactionService.list({
      sourceModule: "FNB",
      sourceId: billId,
    });
    const paid = txs
      .filter((t) => String(t.status).toUpperCase() === "COMPLETED")
      .filter((t) => String(t.transactionType).toUpperCase() === "PAYMENT")
      .reduce((s, t) => s + Number(t.amount ?? 0), 0);
    const total = Number(bill.total ?? 0);

    let paymentStatus = "UNPAID";
    if (paid >= total && total > 0) paymentStatus = "PAID";
    else if (paid > 0) paymentStatus = "PARTIALLY_PAID";

    return fbModel.update(fbModel.tables.bills, billId, {
      paymentStatus,
      status: paymentStatus === "PAID" ? "CLOSED" : bill.status,
      updatedAt: nowIso(),
    });
  },

  async payBill(input: {
    billId: string;
    amount: number;
    paymentMethod?: string;
    externalReference?: string;
    receivedBy?: string;
    notes?: string;
  }) {
    const bill = await withRoundedTotal(await fbModel.get<Row>(fbModel.tables.bills, input.billId));
    if (!bill) throw new AppError("Bill not found", 404);

    const orderId = String(bill.orderId ?? "");
    const order = orderId
      ? await fbModel.get<Row>(fbModel.tables.orders, orderId)
      : null;

    if (String(bill.paymentStatus ?? "").toUpperCase() === "PAID") {
      throw new AppError("This bill is already fully paid", 409);
    }

    const roomCharge = isRoomChargePayment(input.paymentMethod);
    if (roomCharge) {
      if (String(bill.paymentStatus ?? "").toUpperCase() === "PARTIALLY_PAID") {
        throw new AppError("Room Charge can't be used on a part-paid bill — collect the balance with Cash, Card or UPI", 400);
      }
      if (String(order?.type ?? "").trim() !== "Room Service") {
        throw new AppError("Room Charge is only available for Room Service", 400);
      }
      if (!order?.reservationId) {
        throw new AppError("Room Charge requires an in-house guest booking", 400);
      }
      const billTotal = Number(bill.total ?? 0);
      await settleRoomChargeViaRpc({
        billId: input.billId,
        orderId,
        bookingId: String(order.reservationId),
        guestId: order.guestId ? String(order.guestId) : null,
        amount: billTotal,
        notes: `[ROOM_SERVICE] charge — order ${orderId}`,
      });
    } else {
      if (!(input.amount > 0)) throw new AppError("Payment amount must be > 0", 400);

      const txn = await TransactionService.recordViaRpc({
        amount: input.amount,
        transactionType: "PAYMENT",
        paymentMethod: TransactionService.normalizePaymentMethod(
          input.paymentMethod,
        ) as PaymentMethod,
        folioId: null,
        sourceModule: "FNB",
        sourceId: input.billId,
        guestId: order?.guestId ? String(order.guestId) : null,
        bookingId: order?.reservationId ? String(order.reservationId) : null,
        externalReference: input.externalReference ?? null,
        receivedBy: input.receivedBy ?? null,
        notes: input.notes ?? null,
      });
      await FbCashierSessionService.attachTransaction(txn, order?.outletId ? String(order.outletId) : null);
    }

    const updatedBill = roomCharge
      ? ((await fbModel.get<Row>(fbModel.tables.bills, input.billId)) as Row)
      : ((await this.syncBillPaymentStatus(input.billId)) as Row);

    if (String(updatedBill?.paymentStatus) === "PAID" && orderId && !roomCharge) {
      const methods = new Set((await billPayments(input.billId)).map((p) => p.method.toUpperCase()));
      await fbModel.update(fbModel.tables.orders, orderId, {
        status: "Settled",
        lifecycleStatus: "CLOSED",
        paymentMode: methods.size > 1 ? "Split" : input.paymentMethod ?? "Cash",
        paidAt: nowLabel(),
      });

      const sessionId = order?.sessionId ? String(order.sessionId) : null;
      if (sessionId) {
        await fbModel.update(fbModel.tables.tableSessions, sessionId, {
          status: "CLOSED",
          closedAt: nowIso(),
        });
        await TableReservationService.completeForSession(sessionId).catch((e) =>
          console.warn(`[F&B] reservation completion skipped for session ${sessionId}:`, e),
        );
        const session = await fbModel.get<Row>(fbModel.tables.tableSessions, sessionId);
        if (session?.liveTableId) {
          await fbModel.update(fbModel.tables.liveTables, String(session.liveTableId), {
            housekeeping: "DIRTY",
            guest: "—",
            server: "—",
            covers: 0,
            durationMin: 0,
            checkAmount: 0,
            status: "Dirty",
          });
        }
      }
    }

    if (orderId && (roomCharge || String(updatedBill?.paymentStatus) === "PAID")) {
      await consumeRecipesForOrder(orderId).catch((e) =>
        console.warn(`[F&B] recipe stock deduction skipped for order ${orderId}:`, e),
      );
    }

    return {
      bill: updatedBill,
      order: orderId ? await fbModel.get(fbModel.tables.orders, orderId) : null,
    };
  },

  async payBillFull(input: {
    billId: string;
    paymentMethod?: string;
    externalReference?: string;
    receivedBy?: string;
  }) {
    const bill = await withRoundedTotal(await fbModel.get<Row>(fbModel.tables.bills, input.billId));
    if (!bill) throw new AppError("Bill not found", 404);

    const txs = await TransactionService.list({
      sourceModule: "FNB",
      sourceId: input.billId,
    });
    const paid = txs
      .filter((t) => String(t.status).toUpperCase() === "COMPLETED")
      .filter((t) => String(t.transactionType).toUpperCase() === "PAYMENT")
      .reduce((s, t) => s + Number(t.amount ?? 0), 0);
    const remaining = Math.max(0, Number(bill.total ?? 0) - paid);
    if (remaining <= 0) {
      const bill = (await this.syncBillPaymentStatus(input.billId)) as Row;
      const orderId = String(bill.orderId ?? "");
      return {
        bill,
        order: orderId ? await fbModel.get(fbModel.tables.orders, orderId) : null,
      };
    }

    return this.payBill({
      billId: input.billId,
      amount: remaining,
      paymentMethod: input.paymentMethod,
      externalReference: input.externalReference,
      receivedBy: input.receivedBy,
    });
  },

  async payOrderLegacy(orderId: string, paymentMethod: string) {
    const bills = await fbModel.list<Row>(fbModel.tables.bills, {
      filters: { order_id: orderId },
      limit: 1,
    });
    let bill = bills[0];
    if (!bill) {
      const order = await fbModel.get<Row>(fbModel.tables.orders, orderId);
      if (!order) throw new AppError("Order not found", 404);
      bill = await ensureBillForOrder(orderId, Number(order.amount ?? 0));
    }
    return this.payBillFull({
      billId: String(bill.id),
      paymentMethod,
    });
  },

  async advanceKot(kotId: string) {
    const kot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!kot) throw new AppError("KOT not found", 404);

    const flow = ["PENDING", "PREPARING", "READY", "SERVED"] as const;
    const idx = flow.indexOf(String(kot.status) as (typeof flow)[number]);
    if (idx < 0 || idx >= flow.length - 1) {
      throw new AppError(`Cannot advance KOT from ${String(kot.status)}`, 400);
    }
    const next = flow[idx + 1];

    const updated = await fbModel.update(fbModel.tables.kotTickets, kotId, {
      status: next,
      updatedAt: nowIso(),
    });

    const kotItems = await fbModel.list<Row>(fbModel.tables.kotItems, {
      filters: { kot_id: kotId },
    });
    await Promise.all(
      kotItems
        .filter((i) => String(i.status).toUpperCase() !== "CANCELLED")
        .map((i) =>
          fbModel.update(fbModel.tables.kotItems, String(i.id), { status: next }),
        ),
    );

    const orderId = String(kot.orderId ?? "");
    if (orderId) {
      const kots = await fbModel.list<Row>(fbModel.tables.kotTickets, {
        filters: { order_id: orderId },
      });
      const orderStatus = deriveOrderStatusFromKots(kots);
      if (orderStatus) {
        await fbModel.update(fbModel.tables.orders, orderId, { status: orderStatus });
      }
    }

    return updated;
  },

  async syncOrderStatusFromKots(orderId: string) {
    const kots = await fbModel.list<Row>(fbModel.tables.kotTickets, {
      filters: { order_id: orderId },
    });
    const orderStatus = deriveOrderStatusFromKots(kots);
    if (orderStatus) {
      await fbModel.update(fbModel.tables.orders, orderId, { status: orderStatus });
    }
    return orderStatus;
  },

  async buildKotRow(kot: Row, orderById: Map<string, Row>) {
    const order = orderById.get(String(kot.orderId ?? ""));
    if (!order) return null;

    const orderId = String(kot.orderId ?? "");
    const [kotItems, orderItems] = await Promise.all([
      fbModel.list<Row>(fbModel.tables.kotItems, {
        filters: { kot_id: String(kot.id) },
      }),
      getOrderItems(orderId),
    ]);

    const orderItemById = new Map(
      orderItems.map((item) => [String(item.id), item]),
    );

    const lines = kotItems.map((ki) => {
      const orderItem = orderItemById.get(String(ki.orderItemId ?? ""));
      const qty = Number(ki.quantity ?? orderItem?.quantity ?? 1);
      const unitPrice = Number(orderItem?.unitPrice ?? 0);
      const lineStatus = String(ki.status ?? "PENDING").toUpperCase();
      const modifiers = orderItem ? modifierNames(orderItem) : [];
      return {
        id: String(ki.id),
        name: String(orderItem?.name ?? "Item"),
        qty,
        unitPrice,
        lineTotal: lineStatus === "CANCELLED" ? 0 : qty * unitPrice,
        status: lineStatus,
        modifiers,
        ...(orderItem?.note ? { note: String(orderItem.note) } : {}),
      };
    });

    const amount = lines
      .filter((line) => line.status !== "CANCELLED")
      .reduce((sum, line) => sum + line.lineTotal, 0);
    const kotStatus = String(kot.status ?? "PENDING").toUpperCase();

    return {
      id: String(kot.id),
      kotNo: String(kot.kotNumber ?? kot.id),
      orderId,
      orderNo: String(order.orderNo ?? order.id ?? ""),
      orderType: String(order.type ?? "Dine In"),
      ref: String(order.ref ?? ""),
      guest: String(order.guest ?? "Walk-in"),
      server: String(order.server ?? "—"),
      outletId: String(order.outletId ?? ""),
      status: kotUiStatus(kotStatus),
      kotStatus,
      placedAt: String(order.placedAt ?? kot.createdAt ?? ""),
      createdAt: kot.createdAt ?? null,
      readyAt: kotStatus === "READY" || kotStatus === "SERVED" ? (kot.updatedAt ?? null) : null,
      printedAt: kot.printedAt ?? null,
      prepMinutes:
        order.prepMinutes != null ? Number(order.prepMinutes) : null,
      rejectReason: order.rejectReason ? String(order.rejectReason) : null,
      lines: lines.map(({ id, name, qty, note, status, modifiers }) => ({
        id,
        name,
        qty,
        status,
        ...(modifiers.length ? { modifiers } : {}),
        ...(note ? { note } : {}),
      })),
      amount,
    };
  },

  async listKots(outletId?: string) {
    const [kots, orders] = await Promise.all([
      fbModel.list<Row>(fbModel.tables.kotTickets, {
        orderBy: "created_at",
        ascending: false,
      }),
      fbModel.list<Row>(fbModel.tables.orders, {}),
    ]);

    const orderById = new Map(
      orders.map((order) => [String(order.id), order]),
    );

    const scoped = kots.filter((kot) => {
      const order = orderById.get(String(kot.orderId ?? ""));
      if (!order) return false;
      if (outletId && String(order.outletId ?? "") !== outletId) return false;
      const kotStatus = String(kot.status ?? "").toUpperCase();
      return kotStatus !== "SERVED" && kotStatus !== "CANCELLED";
    });

    for (const kot of scoped) {
      if (String(kot.status ?? "").toUpperCase() === "PENDING") {
        await this.acceptKot(String(kot.id), null);
      }
    }

    const refreshedKots =
      scoped.some((k) => String(k.status ?? "").toUpperCase() === "PENDING")
        ? await fbModel.list<Row>(fbModel.tables.kotTickets, {
            orderBy: "created_at",
            ascending: false,
          })
        : kots;

    const rows = await Promise.all(
      refreshedKots
        .filter((kot) => {
          const order = orderById.get(String(kot.orderId ?? ""));
          if (!order) return false;
          if (outletId && String(order.outletId ?? "") !== outletId) return false;
          const kotStatus = String(kot.status ?? "").toUpperCase();
          return kotStatus !== "SERVED" && kotStatus !== "CANCELLED";
        })
        .map((kot) => this.buildKotRow(kot, orderById)),
    );

    return rows.filter((row): row is NonNullable<typeof row> => row != null);
  },

  async acceptKot(kotId: string, prepMinutes?: number | null) {
    const kot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!kot) throw new AppError("KOT not found", 404);
    if (String(kot.status).toUpperCase() !== "PENDING") {
      throw new AppError("Only pending KOTs can be accepted", 400);
    }

    await fbModel.update(fbModel.tables.kotTickets, kotId, {
      status: "PREPARING",
      updatedAt: nowIso(),
    });

    const kotItems = await fbModel.list<Row>(fbModel.tables.kotItems, {
      filters: { kot_id: kotId },
    });
    await Promise.all(
      kotItems.map((item) =>
        fbModel.update(fbModel.tables.kotItems, String(item.id), {
          status: "PREPARING",
        }),
      ),
    );

    const orderId = String(kot.orderId ?? "");
    if (orderId) {
      const patch: Record<string, unknown> = { rejectReason: null };
      if (prepMinutes != null && Number.isFinite(prepMinutes) && prepMinutes >= 0) {
        patch.prepMinutes = Math.round(prepMinutes);
      }
      await fbModel.update(fbModel.tables.orders, orderId, patch);
      await this.syncOrderStatusFromKots(orderId);
    }

    const orders = await fbModel.list<Row>(fbModel.tables.orders, {});
    const orderById = new Map(orders.map((order) => [String(order.id), order]));
    const updatedKot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!updatedKot) throw new AppError("KOT not found", 404);
    const row = await this.buildKotRow(updatedKot, orderById);
    if (!row) throw new AppError("KOT not found", 404);
    return row;
  },

  async rejectKot(kotId: string, reason: string) {
    const kot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!kot) throw new AppError("KOT not found", 404);

    const kotStatus = String(kot.status).toUpperCase();
    if (!CANCELLABLE_KOT.has(kotStatus)) {
      throw new AppError(`Cannot cancel KOT in ${kotStatus} status`, 400);
    }

    const orderId = String(kot.orderId ?? "");
    if (orderId) await assertBillAdjustable(orderId);

    const kotItems = await fbModel.list<Row>(fbModel.tables.kotItems, {
      filters: { kot_id: kotId },
    });

    for (const item of kotItems) {
      if (String(item.status).toUpperCase() === "CANCELLED") continue;
      await fbModel.update(fbModel.tables.kotItems, String(item.id), {
        status: "CANCELLED",
      });
      await voidOrderItemQuantity(
        String(item.orderItemId),
        Number(item.quantity ?? 1),
      );
    }

    await fbModel.update(fbModel.tables.kotTickets, kotId, {
      status: "CANCELLED",
      updatedAt: nowIso(),
    });

    if (orderId) {
      await syncBillAfterCancellation(orderId);
      await this.syncOrderStatusFromKots(orderId);
      await syncOrderLifecycleFromItems(orderId);
    }

    const orders = await fbModel.list<Row>(fbModel.tables.orders, {});
    const orderById = new Map(orders.map((order) => [String(order.id), order]));
    const updatedKot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!updatedKot) throw new AppError("KOT not found", 404);
    const row = await this.buildKotRow(updatedKot, orderById);
    if (!row) throw new AppError("KOT not found", 404);
    return { ...row, rejectReason: reason };
  },

  async cancelKotItem(kotItemId: string, reason: string) {
    const kotItem = await fbModel.get<Row>(fbModel.tables.kotItems, kotItemId);
    if (!kotItem) throw new AppError("KOT item not found", 404);
    if (String(kotItem.status).toUpperCase() === "CANCELLED") {
      throw new AppError("KOT item already cancelled", 400);
    }

    const kotId = String(kotItem.kotId);
    const kot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!kot) throw new AppError("KOT not found", 404);

    const kotStatus = String(kot.status).toUpperCase();
    if (kotStatus === "CANCELLED" || kotStatus === "SERVED") {
      throw new AppError(`Cannot cancel item on ${kotStatus} KOT`, 400);
    }
    if (!CANCELLABLE_KOT.has(kotStatus)) {
      throw new AppError(`Cannot cancel item on ${kotStatus} KOT`, 400);
    }

    const orderId = String(kot.orderId ?? "");
    if (orderId) await assertBillAdjustable(orderId);

    await fbModel.update(fbModel.tables.kotItems, kotItemId, {
      status: "CANCELLED",
    });
    await voidOrderItemQuantity(
      String(kotItem.orderItemId),
      Number(kotItem.quantity ?? 1),
    );
    await maybeCancelKotTicket(kotId);

    if (orderId) {
      await syncBillAfterCancellation(orderId);
      await this.syncOrderStatusFromKots(orderId);
      await syncOrderLifecycleFromItems(orderId);
    }

    const orders = await fbModel.list<Row>(fbModel.tables.orders, {});
    const orderById = new Map(orders.map((order) => [String(order.id), order]));
    const updatedKot = await fbModel.get<Row>(fbModel.tables.kotTickets, kotId);
    if (!updatedKot) throw new AppError("KOT not found", 404);
    const row = await this.buildKotRow(updatedKot, orderById);
    if (!row) throw new AppError("KOT not found", 404);
    return { ...row, rejectReason: reason };
  },

  async syncKitchenFromOrder(orderId: string, orderStatus: string) {
    const kotStatus = KITCHEN_TO_KOT[orderStatus];
    if (!kotStatus) return;

    const kots = await fbModel.list<Row>(fbModel.tables.kotTickets, {
      filters: { order_id: orderId },
    });
    for (const kot of kots) {
      if (String(kot.status) === "CANCELLED") continue;
      await fbModel.update(fbModel.tables.kotTickets, String(kot.id), {
        status: kotStatus,
        updatedAt: nowIso(),
      });
    }
  },

  async listBills(outletId?: string) {
    const [bills, orders] = await Promise.all([
      fbModel.list<Row>(fbModel.tables.bills, {
        orderBy: "created_at",
        ascending: false,
      }),
      fbModel.list<Row>(fbModel.tables.orders, {}),
    ]);

    const orderById = new Map(
      orders.map((order) => [String(order.id), order]),
    );

    return bills
      .map((bill) => {
        const order = orderById.get(String(bill.orderId ?? ""));
        return { bill, order: order ?? null };
      })
      .filter(({ order }) => {
        if (!outletId) return true;
        return order && String(order.outletId ?? "") === outletId;
      })
      .map(({ bill, order }) => ({
        id: String(bill.id),
        billNo: String(bill.billNo ?? bill.id),
        orderId: String(bill.orderId ?? ""),
        orderNo: order ? String(order.orderNo ?? order.id ?? "") : "",
        orderType: order ? String(order.type ?? "Dine In") : "",
        ref: order ? String(order.ref ?? "") : "",
        guest: order ? String(order.guest ?? "—") : "—",
        server: order ? String(order.server ?? "—") : "—",
        outletId: order ? String(order.outletId ?? "") : "",
        total: Number(bill.total ?? 0),
        subtotal: Number(bill.subtotal ?? bill.total ?? 0),
        tax: Number(bill.tax ?? 0),
        discount: Number(bill.discount ?? 0),
        status: String(bill.status ?? "OPEN"),
        paymentStatus: String(bill.paymentStatus ?? "UNPAID"),
        billPrintedAt: bill.billPrintedAt ?? null,
        createdAt: bill.createdAt ?? null,
      }));
  },

  ACTIVE_KOT,
};

function deriveOrderStatusFromKots(kots: Row[]): string | null {
  if (!kots.length) return null;
  const statuses = kots
    .filter((k) => String(k.status) !== "CANCELLED")
    .map((k) => String(k.status));

  if (!statuses.length) return null;
  if (statuses.every((s) => s === "SERVED")) return "Served";
  if (statuses.some((s) => s === "READY")) return "Ready";
  if (statuses.some((s) => s === "PREPARING")) return "Preparing";
  if (statuses.some((s) => s === "PENDING")) return "Pending";
  return null;
}

export { deriveOrderStatusFromKots, syncLegacyOrderLines, getOpenSessionForTable };

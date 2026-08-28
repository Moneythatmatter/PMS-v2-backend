import { fbModel } from "../../models/food-beverages/index.js";
import { TransactionService } from "../shared/transaction.service.js";
import { AppError } from "../../errors/index.js";
import type { PaymentMethod } from "../../types/transactions.js";

type Row = Record<string, unknown>;

export type PosLineInput = {
  menuItemId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
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

function syncLegacyOrderLines(items: Row[]) {
  return items
    .filter((i) => String(i.status ?? "ACTIVE") === "ACTIVE")
    .map((i) => ({
      name: String(i.name ?? ""),
      qty: Number(i.quantity ?? 1),
      ...(i.note ? { note: String(i.note) } : {}),
    }));
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
  const bills = await fbModel.list<Row>(fbModel.tables.bills, {
    filters: { order_id: orderId },
    limit: 1,
  });
  const bill = bills[0];
  if (!bill) return;
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
  await assertBillAdjustable(orderId);
  const amount = await recomputeOrderAmount(orderId);
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

async function ensureBillForOrder(orderId: string, subtotal: number) {
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
      tax: Number(bill.tax ?? 0),
      discount: Number(bill.discount ?? 0),
      total: subtotal + Number(bill.tax ?? 0) - Number(bill.discount ?? 0),
      updatedAt: nowIso(),
    });
  }

  return fbModel.create<Row>(fbModel.tables.bills, {
    id: fbModel.newId("BL"),
    orderId,
    status: "OPEN",
    paymentStatus: "UNPAID",
    subtotal,
    tax: 0,
    discount: 0,
    total: subtotal,
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
}) {
  return fbModel.create<Row>(fbModel.tables.tableSessions, {
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
          session = await createSession({
            liveTableId: String(liveTable.id),
            outletId: input.outletId,
            guest: input.guest,
            guestId: input.guestId,
            guestNo: input.guestNo,
            reservationId: input.reservationId,
            pax: input.pax,
            server: input.server,
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

    for (const line of input.lines) {
      const qty = Math.max(1, Number(line.qty) || 1);
      const unitPrice = Number(line.unitPrice) || 0;
      const item = await fbModel.create<Row>(fbModel.tables.orderItems, {
        id: fbModel.newId("OI"),
        orderId,
        menuItemId: line.menuItemId ?? null,
        name: line.name,
        quantity: qty,
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

    return { order, items, kots: kotsWithItems, bills };
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

    return fbModel.update(fbModel.tables.bills, billId, {
      billPrintedAt: nowIso(),
      updatedAt: nowIso(),
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
    const bill = await fbModel.get<Row>(fbModel.tables.bills, input.billId);
    if (!bill) throw new AppError("Bill not found", 404);

    const orderId = String(bill.orderId ?? "");
    const order = orderId
      ? await fbModel.get<Row>(fbModel.tables.orders, orderId)
      : null;

    if (!(input.amount > 0)) throw new AppError("Payment amount must be > 0", 400);

    await TransactionService.recordViaRpc({
      amount: input.amount,
      paymentMethod: TransactionService.normalizePaymentMethod(
        input.paymentMethod,
      ) as PaymentMethod,
      sourceModule: "FNB",
      sourceId: input.billId,
      guestId: order?.guestId ? String(order.guestId) : null,
      bookingId: order?.reservationId ? String(order.reservationId) : null,
      externalReference: input.externalReference ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
    });

    const updatedBill = (await this.syncBillPaymentStatus(input.billId)) as Row;

    if (String(updatedBill.paymentStatus) === "PAID" && orderId) {
      await fbModel.update(fbModel.tables.orders, orderId, {
        status: "Settled",
        lifecycleStatus: "CLOSED",
        paymentMode: input.paymentMethod ?? "Cash",
        paidAt: nowLabel(),
      });

      const sessionId = order?.sessionId ? String(order.sessionId) : null;
      if (sessionId) {
        await fbModel.update(fbModel.tables.tableSessions, sessionId, {
          status: "CLOSED",
          closedAt: nowIso(),
        });
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

    return { bill: updatedBill, order: orderId ? await fbModel.get(fbModel.tables.orders, orderId) : null };
  },

  async payBillFull(input: {
    billId: string;
    paymentMethod?: string;
    externalReference?: string;
    receivedBy?: string;
  }) {
    const bill = await fbModel.get<Row>(fbModel.tables.bills, input.billId);
    if (!bill) throw new AppError("Bill not found", 404);

    const txs = await TransactionService.list({
      sourceModule: "FNB",
      sourceId: input.billId,
    });
    const paid = txs
      .filter((t) => String(t.status).toUpperCase() === "COMPLETED")
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
      return {
        id: String(ki.id),
        name: String(orderItem?.name ?? "Item"),
        qty,
        unitPrice,
        lineTotal: lineStatus === "CANCELLED" ? 0 : qty * unitPrice,
        status: lineStatus,
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
      printedAt: kot.printedAt ?? null,
      prepMinutes:
        order.prepMinutes != null ? Number(order.prepMinutes) : null,
      rejectReason: order.rejectReason ? String(order.rejectReason) : null,
      lines: lines.map(({ id, name, qty, note, status }) => ({
        id,
        name,
        qty,
        status,
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

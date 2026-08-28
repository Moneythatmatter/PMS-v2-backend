import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { PosService } from "../../services/food-beverages/pos.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Order = Record<string, unknown>;
type LiveTable = Record<string, unknown>;

/** Happy-path kitchen → billing flow (Rejected is terminal / separate). */
const ORDER_FLOW = ["Pending", "Preparing", "Ready", "Served", "Settled"] as const;

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

async function findLiveTable(outletId: string, tableNo: string) {
  const normalized = tableNo.trim().toLowerCase();
  if (!outletId || !normalized) return null;

  const rows = await fbModel.list<LiveTable>(fbModel.tables.liveTables, {
    filters: { outlet_id: outletId },
  });

  return (
    rows.find((t) => String(t.tableNo ?? "").toLowerCase() === normalized) ??
    null
  );
}

async function occupyLiveTableForOrder(order: Order) {
  if (String(order.type ?? "") !== "Dine In") return;

  const outletId = String(order.outletId ?? "");
  const ref = String(order.ref ?? "").trim();
  if (!isDineInTableRef(ref) || !outletId) return;

  const table = await findLiveTable(outletId, ref);
  if (!table?.id) return;

  const pax = Number(order.pax ?? 0);
  const covers =
    Number.isFinite(pax) && pax > 0
      ? pax
      : Number(table.covers ?? table.capacity ?? 2);

  await fbModel.update(fbModel.tables.liveTables, String(table.id), {
    status: "Occupied",
    guest: order.guest ?? "Walk-in",
    server: order.server ?? "—",
    covers,
    durationMin: 0,
    checkAmount: Number(order.amount ?? 0),
  });
}

async function releaseLiveTableForOrder(order: Order) {
  if (String(order.type ?? "") !== "Dine In") return;

  const outletId = String(order.outletId ?? "");
  const ref = String(order.ref ?? "").trim();
  if (!isDineInTableRef(ref) || !outletId) return;

  const table = await findLiveTable(outletId, ref);
  if (!table?.id) return;

  await fbModel.update(fbModel.tables.liveTables, String(table.id), {
    status: "Dirty",
    guest: "—",
    server: "—",
    covers: 0,
    durationMin: 0,
    checkAmount: 0,
  });
}

export async function listOrders(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId as string | undefined;
    const status = req.query.status as string | undefined;
    const filters: Record<string, string | undefined> = {
      outlet_id: outletId,
      status,
    };
    const rows = await fbModel.list<Order>(fbModel.tables.orders, {
      filters,
      orderBy: "id",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getOrder(req: Request, res: Response) {
  try {
    const row = await fbModel.get(fbModel.tables.orders, String(req.params.id));
    if (!row) return fail(res, "Order not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createOrder(req: Request, res: Response) {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    if (!body.id) body.id = fbModel.newId("OR");
    if (!body.status) body.status = "Pending";
    if (!body.lifecycleStatus) body.lifecycleStatus = "OPEN";
    if (!body.placedAt) body.placedAt = nowLabel();
    if (!Array.isArray(body.lines)) body.lines = [];
    const row = await fbModel.create(fbModel.tables.orders, body);
    await occupyLiveTableForOrder(row as Order);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateOrder(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    const row = await fbModel.update(fbModel.tables.orders, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteOrder(req: Request, res: Response) {
  try {
    await fbModel.remove(fbModel.tables.orders, String(req.params.id));
    return ok(res, { id: req.params.id });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function advanceOrder(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get<Order>(fbModel.tables.orders, id);
    if (!existing) return fail(res, "Order not found", 404);

    const current = String(existing.status);
    if (current === "Rejected") {
      return fail(res, "Rejected orders cannot be advanced");
    }
    if (current === "Served") {
      return fail(
        res,
        "Served orders must be settled in POS Billing (collect payment)",
        400,
      );
    }
    // Kitchen owns Pending→Preparing (accept) and Preparing→Ready
    // Service owns Ready→Served; Settled only via /pay
    const idx = ORDER_FLOW.indexOf(current as (typeof ORDER_FLOW)[number]);
    if (idx < 0 || idx >= ORDER_FLOW.length - 1) {
      return fail(res, `Cannot advance from status ${current}`);
    }
    const next = ORDER_FLOW[idx + 1];
    if (next === "Settled") {
      return fail(res, "Use POS Billing to settle the bill", 400);
    }
    const row = await fbModel.update(fbModel.tables.orders, id, { status: next });
    await PosService.syncKitchenFromOrder(id, next);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

/** Kitchen accepts a pending order → Preparing (+ optional prep ETA minutes). */
export async function acceptOrder(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get<Order>(fbModel.tables.orders, id);
    if (!existing) return fail(res, "Order not found", 404);
    if (String(existing.status) !== "Pending") {
      return fail(res, "Only pending orders can be accepted", 400);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const prepRaw = body.prepMinutes ?? body.prep_minutes;
    const prepMinutes =
      prepRaw === undefined || prepRaw === null || prepRaw === ""
        ? null
        : Number(prepRaw);
    if (prepMinutes != null && (!Number.isFinite(prepMinutes) || prepMinutes < 0)) {
      return fail(res, "prepMinutes must be a non-negative number", 400);
    }

    const patch: Record<string, unknown> = {
      status: "Preparing",
      rejectReason: null,
    };
    if (prepMinutes != null) patch.prepMinutes = Math.round(prepMinutes);

    const row = await fbModel.update(fbModel.tables.orders, id, patch);
    await PosService.syncKitchenFromOrder(id, "Preparing");
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

/** Kitchen rejects a pending order with a reason. */
export async function rejectOrder(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get<Order>(fbModel.tables.orders, id);
    if (!existing) return fail(res, "Order not found", 404);
    if (String(existing.status) !== "Pending") {
      return fail(res, "Only pending orders can be rejected", 400);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? body.rejectReason ?? "").trim();
    if (!reason) return fail(res, "Rejection reason is required", 400);

    const row = await fbModel.update(fbModel.tables.orders, id, {
      status: "Rejected",
      rejectReason: reason,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

/** POS collects payment — routes through fb_bills + transactions when available. */
export async function payOrder(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get<Order>(fbModel.tables.orders, id);
    if (!existing) return fail(res, "Order not found", 404);

    const status = String(existing.status);
    const lifecycle = String(existing.lifecycleStatus ?? "OPEN");
    if (
      lifecycle === "CLOSED" ||
      status === "Settled" ||
      String(existing.paymentMode ?? "").length > 0
    ) {
      return fail(res, "Order is already settled", 400);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const paymentMode = String(body.paymentMode ?? body.mode ?? "Cash").trim() || "Cash";

    try {
      const result = await PosService.payOrderLegacy(id, paymentMode);
      const order = (result as { order?: Order }).order ?? existing;
      return ok(res, order);
    } catch {
      if (status !== "Served" && status !== "Ready") {
        return fail(
          res,
          "Only Served or Ready orders can be paid. Mark Served on Orders first.",
          400,
        );
      }

      const row = await fbModel.update(fbModel.tables.orders, id, {
        status: "Settled",
        lifecycleStatus: "CLOSED",
        paymentMode,
        paidAt: nowLabel(),
      });
      await releaseLiveTableForOrder(row as Order);
      return ok(res, row);
    }
  } catch (e) {
    return fromError(res, e);
  }
}

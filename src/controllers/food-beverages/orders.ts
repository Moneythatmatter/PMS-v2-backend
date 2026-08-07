import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Order = Record<string, unknown>;

const ORDER_FLOW = ["Pending", "Preparing", "Ready", "Served", "Settled"] as const;

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
    if (!body.orderNo) body.orderNo = fbModel.newCode("ORD");
    if (!body.status) body.status = "Pending";
    if (!body.placedAt) {
      body.placedAt = new Date().toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    if (!Array.isArray(body.lines)) body.lines = [];
    const row = await fbModel.create(fbModel.tables.orders, body);
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
    const idx = ORDER_FLOW.indexOf(current as (typeof ORDER_FLOW)[number]);
    if (idx < 0 || idx >= ORDER_FLOW.length - 1) {
      return fail(res, `Cannot advance from status ${current}`);
    }
    const next = ORDER_FLOW[idx + 1];
    const row = await fbModel.update(fbModel.tables.orders, id, { status: next });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

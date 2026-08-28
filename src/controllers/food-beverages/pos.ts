import type { Request, Response } from "express";
import { PosService } from "../../services/food-beverages/pos.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function sendKot(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const linesRaw = body.lines ?? body.items ?? [];
    if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
      return fail(res, "At least one line item is required", 400);
    }

    const lines = linesRaw.map((raw: Record<string, unknown>) => ({
      menuItemId:
        raw.menuItemId != null
          ? String(raw.menuItemId)
          : raw.menu_item_id != null
            ? String(raw.menu_item_id)
            : undefined,
      name: String(raw.name ?? ""),
      qty: Number(raw.qty ?? raw.quantity ?? 1),
      unitPrice: Number(raw.unitPrice ?? raw.price ?? raw.unit_price ?? 0),
      note: raw.note ? String(raw.note) : undefined,
    }));

    const result = await PosService.sendKot({
      outletId: String(body.outletId ?? ""),
      type: String(body.type ?? "Dine In"),
      ref: body.ref ? String(body.ref) : undefined,
      liveTableId: body.liveTableId ? String(body.liveTableId) : undefined,
      guest: body.guest ? String(body.guest) : undefined,
      guestId: body.guestId ? String(body.guestId) : undefined,
      guestNo: body.guestNo ? String(body.guestNo) : undefined,
      reservationId: body.reservationId ? String(body.reservationId) : undefined,
      pax: body.pax != null ? Number(body.pax) : undefined,
      server: body.server ? String(body.server) : undefined,
      lines,
      print: body.print === true,
      orderId: body.orderId ? String(body.orderId) : undefined,
    });

    return ok(res, result, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getOpenTableOrder(req: Request, res: Response) {
  try {
    const liveTableId = String(req.params.tableId);
    const result = await PosService.getOpenOrderForTable(liveTableId);
    if (!result) return ok(res, null);
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getOrderDetails(req: Request, res: Response) {
  try {
    const result = await PosService.getOrderWithDetails(String(req.params.id));
    if (!result) return fail(res, "Order not found", 404);
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function printBill(req: Request, res: Response) {
  try {
    const billId = String(req.params.billId);
    const row = await PosService.printBill(billId);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function printBillForOrder(req: Request, res: Response) {
  try {
    const orderId = String(req.params.orderId);
    const row = await PosService.printBillForOrder(orderId);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listBills(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId ? String(req.query.outletId) : undefined;
    const rows = await PosService.listBills(outletId);
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listKots(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId ? String(req.query.outletId) : undefined;
    const rows = await PosService.listKots(outletId);
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function acceptKot(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const prepRaw = body.prepMinutes ?? body.prep_minutes;
    const prepMinutes =
      prepRaw === undefined || prepRaw === null || prepRaw === ""
        ? null
        : Number(prepRaw);
    const row = await PosService.acceptKot(String(req.params.kotId), prepMinutes);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function rejectKot(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? body.rejectReason ?? "").trim();
    if (!reason) return fail(res, "Rejection reason is required", 400);
    const row = await PosService.rejectKot(String(req.params.kotId), reason);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelKotItem(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? "Cancelled from kitchen").trim();
    const row = await PosService.cancelKotItem(String(req.params.kotItemId), reason);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function advanceKot(req: Request, res: Response) {
  try {
    const kotId = String(req.params.kotId);
    await PosService.advanceKot(kotId);
    const rows = await PosService.listKots();
    const row = rows.find((kot) => kot.id === kotId);
    if (!row) return fail(res, "KOT not found after advance", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function payBill(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const billId = String(req.params.billId);
    const fullPay = body.fullPay === true || body.full === true;

    const result = fullPay
      ? await PosService.payBillFull({
          billId,
          paymentMethod: body.paymentMode
            ? String(body.paymentMode)
            : body.paymentMethod
              ? String(body.paymentMethod)
              : undefined,
          externalReference: body.externalReference
            ? String(body.externalReference)
            : undefined,
          receivedBy: body.receivedBy ? String(body.receivedBy) : undefined,
        })
      : await PosService.payBill({
          billId,
          amount: Number(body.amount ?? 0),
          paymentMethod: body.paymentMode
            ? String(body.paymentMode)
            : body.paymentMethod
              ? String(body.paymentMethod)
              : undefined,
          externalReference: body.externalReference
            ? String(body.externalReference)
            : undefined,
          receivedBy: body.receivedBy ? String(body.receivedBy) : undefined,
          notes: body.notes ? String(body.notes) : undefined,
        });

    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

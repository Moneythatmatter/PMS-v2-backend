import type { Request, Response } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { GuestOrderRequestService } from "../../services/food-beverages/guest-order-requests.service.js";
import { fromError, ok } from "../../utils/response.js";

function tableParams(req: Request) {
  return { tableId: String(req.params.tableId ?? ""), token: String(req.query.t ?? req.body?.t ?? "") };
}

const actorOf = (req: Request) => (req as AuthedRequest).auth?.email ?? "Staff";

/* Public (table QR) */

export async function getTableContext(req: Request, res: Response) {
  try {
    const { tableId, token } = tableParams(req);
    return ok(res, await GuestOrderRequestService.context(tableId, token));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getTableMenu(req: Request, res: Response) {
  try {
    const { tableId, token } = tableParams(req);
    return ok(res, await GuestOrderRequestService.menu(tableId, token));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function submitTableRequest(req: Request, res: Response) {
  try {
    const { tableId, token } = tableParams(req);
    return ok(res, await GuestOrderRequestService.submit(tableId, token, req.body ?? {}), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getTableRequestStatuses(req: Request, res: Response) {
  try {
    const { tableId, token } = tableParams(req);
    const ids = String(req.query.ids ?? "").split(",");
    return ok(res, await GuestOrderRequestService.statuses(tableId, token, ids));
  } catch (e) {
    return fromError(res, e);
  }
}

/* Staff */

export async function listRequests(req: Request, res: Response) {
  try {
    return ok(
      res,
      await GuestOrderRequestService.list({
        status: req.query.status ? String(req.query.status) : undefined,
        outletId: req.query.outletId ? String(req.query.outletId) : undefined,
        source: req.query.source ? String(req.query.source) : undefined,
      }),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function pendingCount(req: Request, res: Response) {
  try {
    return ok(res, await GuestOrderRequestService.pendingCount(req.query.outletId ? String(req.query.outletId) : undefined));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approveRequest(req: Request, res: Response) {
  try {
    return ok(
      res,
      await GuestOrderRequestService.approve(String(req.params.id), { ...(req.body ?? {}), actor: actorOf(req) }),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function rejectRequest(req: Request, res: Response) {
  try {
    return ok(
      res,
      await GuestOrderRequestService.reject(String(req.params.id), { ...(req.body ?? {}), actor: actorOf(req) }),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listTableQrTokens(_req: Request, res: Response) {
  try {
    return ok(res, await GuestOrderRequestService.qrTokens());
  } catch (e) {
    return fromError(res, e);
  }
}

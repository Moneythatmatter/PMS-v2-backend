import type { Request, Response } from "express";
import { GuestPortalService } from "../../services/front-office/guest-portal.service.js";
import { fromError, ok } from "../../utils/response.js";

function roomParams(req: Request) {
  return { roomId: String(req.params.roomId ?? ""), token: String(req.query.t ?? req.body?.t ?? "") };
}

export async function getContext(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.context(roomId, token));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMenu(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.menu(roomId, token));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postFoodOrder(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.orderFood(roomId, token, req.body ?? {}), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postCleaning(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.requestCleaning(roomId, token, req.body ?? {}), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postLaundry(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.requestLaundry(roomId, token, req.body ?? {}), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function putFoodOrder(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.updateFoodOrder(roomId, token, String(req.params.requestId), req.body ?? {}));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function putCleaning(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.updateCleaning(roomId, token, String(req.params.requestId), req.body ?? {}));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function putLaundry(req: Request, res: Response) {
  try {
    const { roomId, token } = roomParams(req);
    return ok(res, await GuestPortalService.updateLaundry(roomId, token, String(req.params.requestId), req.body ?? {}));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listQrTokens(_req: Request, res: Response) {
  try {
    return ok(res, await GuestPortalService.qrTokens());
  } catch (e) {
    return fromError(res, e);
  }
}

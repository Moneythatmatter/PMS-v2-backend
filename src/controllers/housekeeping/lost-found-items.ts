import type { Request, Response } from "express";
import { LostFoundItemService } from "../../services/housekeeping/lost-found-item.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function listLostFoundItems(req: Request, res: Response) {
  try {
    const rows = await LostFoundItemService.list({
      status: req.query.status as string | undefined,
      roomId: req.query.roomId as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLostFoundItem(req: Request, res: Response) {
  try {
    return ok(res, await LostFoundItemService.get(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createLostFoundItem(req: Request, res: Response) {
  try {
    const row = await LostFoundItemService.create(
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateLostFoundItem(req: Request, res: Response) {
  try {
    const row = await LostFoundItemService.update(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function returnLostFoundItem(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      returnedTo?: string;
      claimBy?: string;
      guest?: string;
      returnMethod?: string;
      notes?: string;
    };
    const row = await LostFoundItemService.returnItem(
      String(req.params.id),
      body,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function claimLostFoundItem(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      claimedBy?: string;
      claimBy?: string;
      guest?: string;
      returnMethod?: string;
      notes?: string;
    };
    const row = await LostFoundItemService.claimItem(
      String(req.params.id),
      body,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function disposeLostFoundItem(req: Request, res: Response) {
  try {
    const row = await LostFoundItemService.disposeItem(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function courierLostFoundItem(req: Request, res: Response) {
  try {
    const row = await LostFoundItemService.courierDispatch(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

import type { Request, Response } from "express";
import { GuestRequestService } from "../../services/housekeeping/guest-request.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function listGuestRequests(req: Request, res: Response) {
  try {
    const rows = await GuestRequestService.list({
      status: req.query.status as string | undefined,
      roomId: req.query.roomId as string | undefined,
      bookingId: req.query.bookingId as string | undefined,
      requestType: req.query.requestType as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getGuestRequest(req: Request, res: Response) {
  try {
    return ok(res, await GuestRequestService.get(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createGuestRequest(req: Request, res: Response) {
  try {
    const row = await GuestRequestService.create(
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateGuestRequest(req: Request, res: Response) {
  try {
    const row = await GuestRequestService.update(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function assignGuestRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { assignedTo?: string; assignedStaff?: string };
    const assignedTo = String(body.assignedTo ?? body.assignedStaff ?? "").trim();
    if (!assignedTo) return fail(res, "assignedTo is required", 400);
    const row = await GuestRequestService.assign(
      String(req.params.id),
      assignedTo,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function startGuestRequest(req: Request, res: Response) {
  try {
    const row = await GuestRequestService.start(String(req.params.id));
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function completeGuestRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { notes?: string; remarks?: string };
    const row = await GuestRequestService.complete(
      String(req.params.id),
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelGuestRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { notes?: string; remarks?: string };
    const row = await GuestRequestService.cancel(
      String(req.params.id),
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

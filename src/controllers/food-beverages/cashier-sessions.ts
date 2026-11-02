import type { Request, Response } from "express";
import { FbCashierSessionService } from "../../services/food-beverages/fb-cashier-session.service.js";
import { FbDayCloseService } from "../../services/food-beverages/fb-day-close.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

function linesFromBody(body: Record<string, unknown>) {
  const raw = Array.isArray(body.lines) ? body.lines : [];
  return raw.map((line) => {
    const row = line as Record<string, unknown>;
    const actual = row.actualAmount;
    return {
      paymentMethod: String(row.paymentMethod ?? ""),
      actualAmount: actual == null || actual === "" ? null : Number(actual),
      remarks: row.remarks == null ? null : String(row.remarks),
    };
  });
}

const remarksOf = (body: Record<string, unknown>) => (body.closingRemarks == null ? null : String(body.closingRemarks));
const query = (req: Request, key: string) => (req.query[key] ? String(req.query[key]) : undefined);

export async function listSessions(req: Request, res: Response) {
  try {
    return ok(res, await FbCashierSessionService.list({ outletId: query(req, "outletId"), status: query(req, "status") }));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function activeSession(req: Request, res: Response) {
  try {
    return ok(res, await FbCashierSessionService.activeForCurrentUser(req.query.outletId));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getSession(req: Request, res: Response) {
  try {
    return ok(res, await FbCashierSessionService.detail(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function startSession(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const detail = await FbCashierSessionService.start({
      outletId: body.outletId,
      shiftName: String(body.shiftName ?? ""),
      openingCash: Number(body.openingCash ?? 0),
      openingRemarks: body.openingRemarks == null ? null : String(body.openingRemarks),
    });
    return ok(res, detail, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function saveClosing(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return ok(res, await FbCashierSessionService.saveClosing(String(req.params.id), { lines: linesFromBody(body), closingRemarks: remarksOf(body) }));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function submitClosing(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(req.params.id);
    if (Array.isArray(body.lines) && body.lines.length) {
      await FbCashierSessionService.saveClosing(id, { lines: linesFromBody(body), closingRemarks: remarksOf(body) });
    }
    return ok(res, await FbCashierSessionService.submit(id, remarksOf(body)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approveClosing(req: Request, res: Response) {
  try {
    return ok(res, await FbCashierSessionService.approve(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function rejectClosing(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { remarks?: string };
    if (!body.remarks?.trim()) return fail(res, "A rejection needs an explanation");
    return ok(res, await FbCashierSessionService.reject(String(req.params.id), body.remarks));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function resubmitClosing(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return ok(res, await FbCashierSessionService.resubmit(String(req.params.id), { lines: linesFromBody(body), closingRemarks: remarksOf(body) }));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function dayCloseStatus(req: Request, res: Response) {
  try {
    return ok(res, await FbDayCloseService.status(req.query.outletId));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function runDayClose(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { outletId?: string };
    return ok(res, await FbDayCloseService.run(body.outletId), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function dayCloseHistory(req: Request, res: Response) {
  try {
    return ok(res, await FbDayCloseService.history(query(req, "outletId")));
  } catch (e) {
    return fromError(res, e);
  }
}

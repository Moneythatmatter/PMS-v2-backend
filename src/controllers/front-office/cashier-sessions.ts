import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { CashierSessionService } from "../../services/front-office/cashier-session.service.js";
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

export async function listSessions(req: ContextRequest, res: Response) {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    return ok(res, await CashierSessionService.list(status));
  } catch (error) {
    return fromError(res, error);
  }
}

export async function activeSession(_req: ContextRequest, res: Response) {
  try {
    return ok(res, await CashierSessionService.activeForCurrentUser());
  } catch (error) {
    return fromError(res, error);
  }
}

export async function getSession(req: ContextRequest, res: Response) {
  try {
    return ok(res, await CashierSessionService.detail(String(req.params.id)));
  } catch (error) {
    return fromError(res, error);
  }
}

export async function startSession(req: ContextRequest, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = await CashierSessionService.start({
      shiftName: String(body.shiftName ?? ""),
      openingCash: Number(body.openingCash ?? 0),
      openingRemarks: body.openingRemarks == null ? null : String(body.openingRemarks),
    });
    return ok(res, session, 201);
  } catch (error) {
    return fromError(res, error);
  }
}

export async function saveClosing(req: ContextRequest, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = await CashierSessionService.saveClosing(String(req.params.id), {
      lines: linesFromBody(body),
      closingRemarks: body.closingRemarks == null ? null : String(body.closingRemarks),
    });
    return ok(res, session);
  } catch (error) {
    return fromError(res, error);
  }
}

export async function submitClosing(req: ContextRequest, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (Array.isArray(body.lines) && body.lines.length) {
      await CashierSessionService.saveClosing(String(req.params.id), {
        lines: linesFromBody(body),
        closingRemarks: body.closingRemarks == null ? null : String(body.closingRemarks),
      });
    }
    const session = await CashierSessionService.submit(
      String(req.params.id),
      body.closingRemarks == null ? null : String(body.closingRemarks),
    );
    return ok(res, session);
  } catch (error) {
    return fromError(res, error);
  }
}

export async function approveClosing(req: ContextRequest, res: Response) {
  try {
    return ok(res, await CashierSessionService.approve(String(req.params.id)));
  } catch (error) {
    return fromError(res, error);
  }
}

export async function rejectClosing(req: ContextRequest, res: Response) {
  try {
    const body = (req.body ?? {}) as { remarks?: string };
    if (!body.remarks?.trim()) return fail(res, "A rejection needs an explanation");
    return ok(res, await CashierSessionService.reject(String(req.params.id), body.remarks));
  } catch (error) {
    return fromError(res, error);
  }
}

export async function resubmitClosing(req: ContextRequest, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = await CashierSessionService.resubmit(String(req.params.id), {
      lines: linesFromBody(body),
      closingRemarks: body.closingRemarks == null ? null : String(body.closingRemarks),
    });
    return ok(res, session);
  } catch (error) {
    return fromError(res, error);
  }
}

import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { DayClosingService } from "../../services/front-office/day-closing.service.js";
import { fromError, ok } from "../../utils/response.js";

export async function getStatus(_req: ContextRequest, res: Response) {
  try {
    return ok(res, await DayClosingService.status());
  } catch (error) {
    return fromError(res, error);
  }
}

export async function runClosing(_req: ContextRequest, res: Response) {
  try {
    return ok(res, await DayClosingService.run());
  } catch (error) {
    return fromError(res, error);
  }
}

export async function listHistory(req: ContextRequest, res: Response) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    return ok(res, await DayClosingService.history(limit));
  } catch (error) {
    return fromError(res, error);
  }
}

import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { NightAuditService } from "../../services/front-office/night-audit.service.js";
import { fromError, ok } from "../../utils/response.js";

export async function getStatus(_req: ContextRequest, res: Response) {
  try {
    return ok(res, await NightAuditService.status());
  } catch (error) {
    return fromError(res, error);
  }
}

export async function runAudit(_req: ContextRequest, res: Response) {
  try {
    return ok(res, await NightAuditService.run());
  } catch (error) {
    return fromError(res, error);
  }
}

export async function listHistory(req: ContextRequest, res: Response) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    return ok(res, await NightAuditService.history(limit));
  } catch (error) {
    return fromError(res, error);
  }
}

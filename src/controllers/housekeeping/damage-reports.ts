import type { Request, Response } from "express";
import { DamageReportService } from "../../services/housekeeping/damage-report.service.js";
import { fromError, ok } from "../../utils/response.js";

export async function listDamageReports(req: Request, res: Response) {
  try {
    const rows = await DamageReportService.list({
      status: req.query.status as string | undefined,
      roomId: req.query.roomId as string | undefined,
      damageType: req.query.damageType as string | undefined,
      severity: req.query.severity as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getDamageReport(req: Request, res: Response) {
  try {
    return ok(res, await DamageReportService.get(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createDamageReport(req: Request, res: Response) {
  try {
    const row = await DamageReportService.create(
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateDamageReport(req: Request, res: Response) {
  try {
    const row = await DamageReportService.update(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function resolveDamageReport(req: Request, res: Response) {
  try {
    const row = await DamageReportService.resolve(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

import type { Request, Response } from "express";
import { FloorPlanService } from "../../services/food-beverages/floor-plan.service.js";
import { fromError, ok } from "../../utils/response.js";

export async function listFloorPlan(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId as string | undefined;
    const rows = await FloorPlanService.listFloorPlan(outletId);
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getFloorPlanTable(req: Request, res: Response) {
  try {
    const row = await FloorPlanService.getTableFloorPlan(String(req.params.id));
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

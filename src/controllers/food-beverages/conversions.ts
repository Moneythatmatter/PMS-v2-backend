import type { Request, Response } from "express";
import { fromError, ok, fail } from "../../utils/response.js";
import * as conversions from "../../models/food-beverages/conversions.js";
import { getRequestStore } from "../../utils/request-context.js";

export async function listConversions(_req: Request, res: Response) {
  try {
    return ok(res, await conversions.listConversions());
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getConversion(req: Request, res: Response) {
  try {
    const row = await conversions.getConversion(String(req.params.id));
    if (!row) return fail(res, "Not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createConversion(req: Request, res: Response) {
  try {
    const row = await conversions.createConversion((req.body ?? {}) as Record<string, unknown>);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateConversion(req: Request, res: Response) {
  try {
    const row = await conversions.updateConversion(String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteConversion(req: Request, res: Response) {
  try {
    await conversions.deleteConversion(String(req.params.id));
    return ok(res, { id: String(req.params.id) });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function completeConversion(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const completedBy = String(body.completedBy ?? getRequestStore()?.userId ?? "");
    const row = await conversions.completeConversion(String(req.params.id), completedBy);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

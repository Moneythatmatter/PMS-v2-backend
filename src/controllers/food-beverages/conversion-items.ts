import type { Request, Response } from "express";
import { fromError, ok, fail } from "../../utils/response.js";
import * as items from "../../models/food-beverages/conversion-items.js";

export async function listConversionItems(_req: Request, res: Response) {
  try {
    return ok(res, await items.listConversionItems());
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getConversionItem(req: Request, res: Response) {
  try {
    const row = await items.getConversionItem(String(req.params.id));
    if (!row) return fail(res, "Not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createConversionItem(req: Request, res: Response) {
  try {
    const row = await items.createConversionItem((req.body ?? {}) as Record<string, unknown>);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateConversionItem(req: Request, res: Response) {
  try {
    const row = await items.updateConversionItem(String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteConversionItem(req: Request, res: Response) {
  try {
    await items.deleteConversionItem(String(req.params.id));
    return ok(res, { id: String(req.params.id) });
  } catch (e) {
    return fromError(res, e);
  }
}

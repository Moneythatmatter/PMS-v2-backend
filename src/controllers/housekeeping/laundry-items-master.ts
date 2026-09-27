import type { Request, Response } from "express";
import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type LaundryItem = Record<string, unknown>;

function sanitizeItem(body: Record<string, unknown>): LaundryItem {
  const out: LaundryItem = { ...body };
  delete out.sortOrder;
  if (typeof out.itemCode === "string") {
    out.itemCode = out.itemCode.trim().toUpperCase();
  }
  if (typeof out.name === "string") out.name = out.name.trim();
  if (typeof out.category === "string") out.category = out.category.trim();
  if (typeof out.description === "string") {
    out.description = out.description.trim() || null;
  }
  return out;
}

export async function listLaundryItems(req: Request, res: Response) {
  try {
    const isActive = req.query.isActive as string | undefined;
    const filters: Record<string, string | boolean | undefined> = {};
    if (isActive === "true") filters.is_active = true;
    if (isActive === "false") filters.is_active = false;

    const rows = await hkModel.list<LaundryItem>(hkModel.tables.laundryItems, {
      filters,
      orderBy: "name",
      ascending: true,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLaundryItem(req: Request, res: Response) {
  try {
    const row = await hkModel.get(hkModel.tables.laundryItems, String(req.params.id));
    if (!row) return fail(res, "Laundry item not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createLaundryItem(req: Request, res: Response) {
  try {
    const body = sanitizeItem({ ...(req.body as Record<string, unknown>) });
    if (!body.itemCode) return fail(res, "itemCode is required", 400);
    if (!body.name) return fail(res, "name is required", 400);
    if (!body.id) body.id = hkModel.newId("LI");
    if (!body.category) body.category = "Garment";
    if (body.isActive === undefined) body.isActive = true;

    const row = await hkModel.create(hkModel.tables.laundryItems, body);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateLaundryItem(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hkModel.get(hkModel.tables.laundryItems, id);
    if (!existing) return fail(res, "Laundry item not found", 404);

    const body = sanitizeItem({ ...(req.body as Record<string, unknown>) });
    delete body.id;
    const row = await hkModel.update(hkModel.tables.laundryItems, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteLaundryItem(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hkModel.get(hkModel.tables.laundryItems, id);
    if (!existing) return fail(res, "Laundry item not found", 404);
    await hkModel.remove(hkModel.tables.laundryItems, id);
    return ok(res, { id });
  } catch (e) {
    return fromError(res, e);
  }
}

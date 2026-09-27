import type { Request, Response } from "express";
import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type LaundryPricing = Record<string, unknown>;

function sanitizePricing(body: Record<string, unknown>): LaundryPricing {
  const out: LaundryPricing = { ...body };
  if (typeof out.itemId === "string") out.itemId = out.itemId.trim();
  if (typeof out.serviceType === "string") {
    out.serviceType = out.serviceType.trim();
  }
  if (out.unitPrice != null) {
    out.unitPrice = Math.round(Number(out.unitPrice) * 100) / 100;
  }
  return out;
}

export async function listLaundryPricing(req: Request, res: Response) {
  try {
    const isActive = req.query.isActive as string | undefined;
    const itemId = req.query.itemId as string | undefined;
    const filters: Record<string, string | boolean | undefined> = {};
    if (itemId) filters.item_id = itemId;
    if (isActive === "true") filters.is_active = true;
    if (isActive === "false") filters.is_active = false;

    const rows = await hkModel.list<LaundryPricing>(
      hkModel.tables.laundryPricing,
      {
        filters,
        orderBy: "service_type",
        ascending: true,
      },
    );
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLaundryPricing(req: Request, res: Response) {
  try {
    const row = await hkModel.get(
      hkModel.tables.laundryPricing,
      String(req.params.id),
    );
    if (!row) return fail(res, "Laundry pricing not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createLaundryPricing(req: Request, res: Response) {
  try {
    const body = sanitizePricing({ ...(req.body as Record<string, unknown>) });
    if (!body.itemId) return fail(res, "itemId is required", 400);
    if (!body.serviceType) return fail(res, "serviceType is required", 400);
    if (body.unitPrice == null || Number.isNaN(Number(body.unitPrice))) {
      return fail(res, "unitPrice is required", 400);
    }

    const item = await hkModel.get(hkModel.tables.laundryItems, String(body.itemId));
    if (!item) return fail(res, "Laundry item not found", 404);

    const existingRows = await hkModel.list<LaundryPricing>(
      hkModel.tables.laundryPricing,
      {
        filters: {
          item_id: String(body.itemId),
          service_type: String(body.serviceType),
        },
      },
    );
    if (existingRows.length > 0) {
      const itemName = String(
        (item as { name?: string }).name ?? "This item",
      );
      return fail(
        res,
        `${itemName} with ${body.serviceType} already exists`,
        409,
      );
    }

    if (!body.id) body.id = hkModel.newId("LP");
    if (body.isActive === undefined) body.isActive = true;

    const row = await hkModel.create(hkModel.tables.laundryPricing, body);
    return ok(res, row, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(message)) {
      return fail(res, "Pricing for this item and service already exists", 409);
    }
    return fromError(res, e);
  }
}

export async function updateLaundryPricing(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hkModel.get(hkModel.tables.laundryPricing, id);
    if (!existing) return fail(res, "Laundry pricing not found", 404);

    const body = sanitizePricing({ ...(req.body as Record<string, unknown>) });
    delete body.id;
    if (body.itemId) {
      const item = await hkModel.get(
        hkModel.tables.laundryItems,
        String(body.itemId),
      );
      if (!item) return fail(res, "Laundry item not found", 404);
    }

    const row = await hkModel.update(hkModel.tables.laundryPricing, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteLaundryPricing(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hkModel.get(hkModel.tables.laundryPricing, id);
    if (!existing) return fail(res, "Laundry pricing not found", 404);
    await hkModel.remove(hkModel.tables.laundryPricing, id);
    return ok(res, { id });
  } catch (e) {
    return fromError(res, e);
  }
}

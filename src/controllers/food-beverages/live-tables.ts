import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type LiveTable = Record<string, unknown>;

export async function listLiveTables(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId as string | undefined;
    const rows = await fbModel.list(fbModel.tables.liveTables, {
      filters: outletId ? { outlet_id: outletId } : undefined,
      orderBy: "table_no",
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateLiveTable(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    const row = await fbModel.update(fbModel.tables.liveTables, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function seatTable(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get<LiveTable>(fbModel.tables.liveTables, id);
    if (!existing) return fail(res, "Table not found", 404);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = await fbModel.update(fbModel.tables.liveTables, id, {
      status: "Occupied",
      guest: body.guest ?? "Walk-in",
      server: body.server ?? existing.server ?? "—",
      covers: body.covers ?? existing.capacity ?? 2,
      durationMin: 0,
      checkAmount: body.checkAmount ?? 0,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function settleTable(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await fbModel.get(fbModel.tables.liveTables, id);
    if (!existing) return fail(res, "Table not found", 404);

    const row = await fbModel.update(fbModel.tables.liveTables, id, {
      status: "Dirty",
      housekeeping: "DIRTY",
      guest: "—",
      server: "—",
      covers: 0,
      durationMin: 0,
      checkAmount: 0,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cleanTable(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const row = await fbModel.update(fbModel.tables.liveTables, id, {
      status: "Available",
      housekeeping: "CLEAN",
      guest: "—",
      server: "—",
      covers: 0,
      durationMin: 0,
      checkAmount: 0,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

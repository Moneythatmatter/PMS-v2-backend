import type { Request, Response } from "express";
import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Job = Record<string, unknown>;

const LAUNDRY_FLOW = [
  "Collection",
  "Washing",
  "Ironing",
  "Ready",
  "Delivered",
] as const;

export async function listLaundry(req: Request, res: Response) {
  try {
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const rows = await hkModel.list<Job>(hkModel.tables.laundryJobs, {
      filters: { status, type },
      orderBy: "id",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLaundry(req: Request, res: Response) {
  try {
    const row = await hkModel.get(hkModel.tables.laundryJobs, String(req.params.id));
    if (!row) return fail(res, "Laundry job not found", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createLaundry(req: Request, res: Response) {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    if (!body.id) body.id = hkModel.newId("LD");
    if (!body.status) body.status = "Collection";
    if (!body.timeline) {
      body.timeline = {
        collectedAt: new Date().toISOString(),
      };
    }
    const row = await hkModel.create(hkModel.tables.laundryJobs, body);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateLaundry(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    const row = await hkModel.update(hkModel.tables.laundryJobs, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteLaundry(req: Request, res: Response) {
  try {
    await hkModel.remove(hkModel.tables.laundryJobs, String(req.params.id));
    return ok(res, { id: req.params.id });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function advanceLaundry(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hkModel.get<Job>(hkModel.tables.laundryJobs, id);
    if (!existing) return fail(res, "Laundry job not found", 404);

    const current = String(existing.status);
    const idx = LAUNDRY_FLOW.indexOf(current as (typeof LAUNDRY_FLOW)[number]);
    if (idx < 0 || idx >= LAUNDRY_FLOW.length - 1) {
      return fail(res, `Cannot advance from status ${current}`);
    }

    const next = LAUNDRY_FLOW[idx + 1];
    const timeline = {
      ...((existing.timeline as Record<string, unknown>) ?? {}),
    };
    const stamp = new Date().toISOString();
    if (next === "Washing") timeline.washedAt = stamp;
    if (next === "Ready") timeline.readyAt = stamp;
    if (next === "Delivered") timeline.deliveredAt = stamp;

    const row = await hkModel.update(hkModel.tables.laundryJobs, id, {
      status: next,
      timeline,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

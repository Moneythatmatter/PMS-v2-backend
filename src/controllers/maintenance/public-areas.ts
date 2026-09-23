import type { Request, Response } from "express";
import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { mntModel } from "../../models/maintenance/index.js";
import { toCamel } from "../../utils/mappers.js";
import { fail, fromError, ok } from "../../utils/response.js";
import {
  ensureAllMntPublicAreas,
  ensureMntPublicAreaForMaster,
} from "../../services/maintenance/location-sync.js";
import type { MntLocationStatus } from "./rooms.js";

export type MntPublicArea = {
  id: string;
  propertyId?: string;
  publicAreaId: string;
  status: MntLocationStatus;
  notes?: string | null;
  lastServicedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Enriched from HK public_areas master
  areaCode?: string;
  name?: string;
  areaType?: string;
  location?: string | null;
  floorNumber?: number | null;
  priority?: string;
  isActive?: boolean;
};

type PublicAreaMaster = {
  id: string;
  areaCode?: string;
  name?: string;
  areaType?: string;
  location?: string | null;
  floorNumber?: number | null;
  priority?: string;
  isActive?: boolean;
};

const ALLOWED_STATUSES: MntLocationStatus[] = [
  "Operational",
  "Under Maintenance",
  "Out of Service",
];

function enrich(
  row: MntPublicArea,
  masterById: Map<string, PublicAreaMaster>,
): MntPublicArea {
  const master = masterById.get(String(row.publicAreaId));
  if (!master) return row;
  return {
    ...row,
    areaCode: master.areaCode ?? row.areaCode,
    name: master.name ?? row.name,
    areaType: master.areaType ?? row.areaType,
    location: master.location ?? row.location,
    floorNumber: master.floorNumber ?? row.floorNumber,
    priority: master.priority ?? row.priority,
    isActive: master.isActive ?? row.isActive,
  };
}

async function masterMap(): Promise<Map<string, PublicAreaMaster>> {
  const areas = await hkModel.list<PublicAreaMaster>(
    hkModel.tables.publicAreasMaster,
    { orderBy: "area_code" },
  );
  return new Map(areas.map((a) => [String(a.id), a]));
}

async function findByKey(key: string): Promise<MntPublicArea | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await mntModel.get<MntPublicArea>(
    mntModel.tables.publicAreas,
    trimmed,
  );
  if (byId) return byId;

  const { data, error } = await supabase
    .from(mntModel.tables.publicAreas)
    .select("*")
    .eq("public_area_id", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<MntPublicArea>(data) : null;
}

export async function listMntPublicAreas(req: Request, res: Response) {
  try {
    await ensureAllMntPublicAreas();

    const status = req.query.status as string | undefined;
    const filters: Record<string, string | undefined> = {};
    if (status && status !== "all") filters.status = status;

    const rows = await mntModel.list<MntPublicArea>(
      mntModel.tables.publicAreas,
      {
        filters,
        orderBy: "created_at",
        ascending: false,
      },
    );
    const masters = await masterMap();
    const enriched = rows
      .map((r) => enrich(r, masters))
      .sort((a, b) =>
        String(a.areaCode ?? "").localeCompare(String(b.areaCode ?? "")),
      );
    return ok(res, enriched);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMntPublicArea(req: Request, res: Response) {
  try {
    const row = await findByKey(String(req.params.id));
    if (!row) return fail(res, "Maintenance public area not found", 404);
    const masters = await masterMap();
    return ok(res, enrich(row, masters));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createMntPublicArea(req: Request, res: Response) {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    const publicAreaId = String(
      body.publicAreaId ?? body.public_area_id ?? "",
    ).trim();
    if (!publicAreaId) return fail(res, "publicAreaId is required", 400);

    const master = await hkModel.get<PublicAreaMaster>(
      hkModel.tables.publicAreasMaster,
      publicAreaId,
    );
    if (!master) return fail(res, "Housekeeping public area not found", 404);

    await ensureMntPublicAreaForMaster(publicAreaId);
    const existing = await findByKey(publicAreaId);
    if (!existing) {
      return fail(res, "Failed to create maintenance public area", 500);
    }

    if (body.status || body.notes !== undefined) {
      const patch: Record<string, unknown> = {};
      if (body.status) {
        const status = String(body.status);
        if (!ALLOWED_STATUSES.includes(status as MntLocationStatus)) {
          return fail(res, "Invalid status", 400);
        }
        patch.status = status;
      }
      if (body.notes !== undefined) patch.notes = body.notes;
      const updated = await mntModel.update<MntPublicArea>(
        mntModel.tables.publicAreas,
        existing.id,
        patch,
      );
      const masters = await masterMap();
      return ok(res, enrich(updated, masters), 201);
    }

    const masters = await masterMap();
    return ok(res, enrich(existing, masters), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateMntPublicArea(req: Request, res: Response) {
  try {
    const existing = await findByKey(String(req.params.id));
    if (!existing) return fail(res, "Maintenance public area not found", 404);

    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    delete body.publicAreaId;
    delete body.public_area_id;
    delete body.propertyId;
    delete body.property_id;

    if (body.status != null) {
      const status = String(body.status);
      if (!ALLOWED_STATUSES.includes(status as MntLocationStatus)) {
        return fail(res, "Invalid status", 400);
      }
      body.status = status;
    }

    const row = await mntModel.update<MntPublicArea>(
      mntModel.tables.publicAreas,
      existing.id,
      body,
    );
    const masters = await masterMap();
    return ok(res, enrich(row, masters));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteMntPublicArea(req: Request, res: Response) {
  try {
    const existing = await findByKey(String(req.params.id));
    if (!existing) return fail(res, "Maintenance public area not found", 404);
    await mntModel.remove(mntModel.tables.publicAreas, existing.id);
    return ok(res, { id: existing.id });
  } catch (e) {
    return fromError(res, e);
  }
}

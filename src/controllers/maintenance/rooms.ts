import type { Request, Response } from "express";
import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { mntModel } from "../../models/maintenance/index.js";
import { toCamel } from "../../utils/mappers.js";
import { fail, fromError, ok } from "../../utils/response.js";
import {
  ensureAllMntRooms,
  ensureMntRoomForFoRoom,
} from "../../services/maintenance/location-sync.js";

export type MntLocationStatus =
  | "Operational"
  | "Under Maintenance"
  | "Out of Service";

export type MntRoom = {
  id: string;
  propertyId?: string;
  roomId: string;
  status: MntLocationStatus;
  notes?: string | null;
  lastServicedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Enriched from FO rooms
  roomNo?: string;
  floor?: string;
  roomType?: string;
  bedType?: string;
  maxOccupancy?: number;
  isActive?: boolean;
};

type FoRoom = {
  id: string;
  roomNo?: string;
  floor?: string;
  roomType?: string;
  bedType?: string;
  maxOccupancy?: number;
  isActive?: boolean;
};

const ALLOWED_STATUSES: MntLocationStatus[] = [
  "Operational",
  "Under Maintenance",
  "Out of Service",
];

function enrich(
  row: MntRoom,
  foById: Map<string, FoRoom>,
): MntRoom {
  const fo = foById.get(String(row.roomId));
  if (!fo) return row;
  return {
    ...row,
    roomNo: fo.roomNo ?? row.roomNo,
    floor: fo.floor ?? row.floor,
    roomType: fo.roomType ?? row.roomType,
    bedType: fo.bedType ?? row.bedType,
    maxOccupancy: fo.maxOccupancy ?? row.maxOccupancy,
    isActive: fo.isActive ?? row.isActive,
  };
}

async function foRoomMap(): Promise<Map<string, FoRoom>> {
  const rooms = await foModel.list<FoRoom>(foModel.tables.rooms, {
    orderBy: "room_no",
  });
  return new Map(rooms.map((r) => [String(r.id), r]));
}

async function findByKey(key: string): Promise<MntRoom | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await mntModel.get<MntRoom>(mntModel.tables.rooms, trimmed);
  if (byId) return byId;

  const { data, error } = await supabase
    .from(mntModel.tables.rooms)
    .select("*")
    .eq("room_id", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<MntRoom>(data) : null;
}

export async function listMntRooms(req: Request, res: Response) {
  try {
    await ensureAllMntRooms();

    const status = req.query.status as string | undefined;
    const filters: Record<string, string | undefined> = {};
    if (status && status !== "all") filters.status = status;

    const rows = await mntModel.list<MntRoom>(mntModel.tables.rooms, {
      filters,
      orderBy: "created_at",
      ascending: false,
    });
    const foById = await foRoomMap();
    const enriched = rows
      .map((r) => enrich(r, foById))
      .sort((a, b) =>
        String(a.roomNo ?? "").localeCompare(String(b.roomNo ?? ""), undefined, {
          numeric: true,
        }),
      );
    return ok(res, enriched);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMntRoom(req: Request, res: Response) {
  try {
    const row = await findByKey(String(req.params.id));
    if (!row) return fail(res, "Maintenance room not found", 404);
    const foById = await foRoomMap();
    return ok(res, enrich(row, foById));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createMntRoom(req: Request, res: Response) {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    const roomId = String(body.roomId ?? body.room_id ?? "").trim();
    if (!roomId) return fail(res, "roomId is required", 400);

    const fo = await foModel.get<FoRoom>(foModel.tables.rooms, roomId);
    if (!fo) {
      // Allow room_no lookup
      const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("*")
        .eq("room_no", roomId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return fail(res, "Front Office room not found", 404);
      body.roomId = String((data as { id: string }).id);
    } else {
      body.roomId = roomId;
    }

    await ensureMntRoomForFoRoom(String(body.roomId));
    const existing = await findByKey(String(body.roomId));
    if (!existing) return fail(res, "Failed to create maintenance room", 500);

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
      const updated = await mntModel.update<MntRoom>(
        mntModel.tables.rooms,
        existing.id,
        patch,
      );
      const foById = await foRoomMap();
      return ok(res, enrich(updated, foById), 201);
    }

    const foById = await foRoomMap();
    return ok(res, enrich(existing, foById), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateMntRoom(req: Request, res: Response) {
  try {
    const existing = await findByKey(String(req.params.id));
    if (!existing) return fail(res, "Maintenance room not found", 404);

    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    delete body.roomId;
    delete body.room_id;
    delete body.propertyId;
    delete body.property_id;

    if (body.status != null) {
      const status = String(body.status);
      if (!ALLOWED_STATUSES.includes(status as MntLocationStatus)) {
        return fail(res, "Invalid status", 400);
      }
      body.status = status;
    }

    const row = await mntModel.update<MntRoom>(
      mntModel.tables.rooms,
      existing.id,
      body,
    );
    const foById = await foRoomMap();
    return ok(res, enrich(row, foById));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteMntRoom(req: Request, res: Response) {
  try {
    const existing = await findByKey(String(req.params.id));
    if (!existing) return fail(res, "Maintenance room not found", 404);
    await mntModel.remove(mntModel.tables.rooms, existing.id);
    return ok(res, { id: existing.id });
  } catch (e) {
    return fromError(res, e);
  }
}

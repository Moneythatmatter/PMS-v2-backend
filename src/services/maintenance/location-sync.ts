import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { mntModel } from "../../models/maintenance/index.js";

/**
 * Ensure a maintenance room ops row exists for an FO room.
 * Mirrors ensureHkRoomForFoRoom.
 */
export async function ensureMntRoomForFoRoom(roomId: string): Promise<void> {
  const { data, error } = await supabase
    .from(mntModel.tables.rooms)
    .select("id")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.id) return;

  await mntModel.create(mntModel.tables.rooms, {
    id: foModel.newId(),
    roomId,
    status: "Operational",
  });
}

/**
 * Ensure a maintenance public-area ops row exists for an HK public_areas master.
 */
export async function ensureMntPublicAreaForMaster(
  publicAreaId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from(mntModel.tables.publicAreas)
    .select("id")
    .eq("public_area_id", publicAreaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.id) return;

  await mntModel.create(mntModel.tables.publicAreas, {
    id: foModel.newId(),
    publicAreaId,
    status: "Operational",
  });
}

/** Backfill any FO rooms missing an mnt_rooms row (current property scope). */
export async function ensureAllMntRooms(): Promise<void> {
  const foRooms = await foModel.list<{ id: string }>(foModel.tables.rooms);
  await Promise.all(foRooms.map((r) => ensureMntRoomForFoRoom(String(r.id))));
}

/** Backfill any HK public_areas missing an mnt_public_areas row. */
export async function ensureAllMntPublicAreas(): Promise<void> {
  const { hkModel } = await import("../../models/housekeeping/index.js");
  const areas = await hkModel.list<{ id: string }>(
    hkModel.tables.publicAreasMaster,
  );
  await Promise.all(
    areas.map((a) => ensureMntPublicAreaForMaster(String(a.id))),
  );
}

import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Room } from "../../types/front-office.js";
import { getActivePropertyId } from "../../utils/request-context.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRoomUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function applyPropertyScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
): T {
  const propertyId = getActivePropertyId();
  return propertyId ? query.eq("property_id", propertyId) : query;
}

/** Resolve room id or room number to rooms.id for FK storage. */
export async function resolveRoomId(
  ref: string | null | undefined,
): Promise<string | null> {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  const byId = applyPropertyScope(
    supabase.from(foModel.tables.rooms).select("id").eq("id", trimmed),
  );
  const { data: idRow, error: idError } = await byId.maybeSingle();
  if (idError) throw new Error(idError.message);
  if (idRow?.id) return String(idRow.id);

  if (isRoomUuid(trimmed)) {
    const byFoModel = await foModel.get<Room>(foModel.tables.rooms, trimmed);
    return byFoModel ? trimmed : null;
  }

  const byRoomNo = applyPropertyScope(
    supabase.from(foModel.tables.rooms).select("id").eq("room_no", trimmed),
  );
  const { data: noRow, error: noError } = await byRoomNo.maybeSingle();
  if (noError) throw new Error(noError.message);
  return noRow?.id ? String(noRow.id) : null;
}

/** Load room by rooms.id or display room number. */
export async function getRoomByRef(
  ref: string | null | undefined,
): Promise<Room | null> {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  const byId = applyPropertyScope(
    supabase.from(foModel.tables.rooms).select("*").eq("id", trimmed),
  );
  const { data: idRow, error: idError } = await byId.maybeSingle();
  if (idError) throw new Error(idError.message);
  if (idRow) return toCamel<Room>(idRow);

  if (isRoomUuid(trimmed)) {
    return foModel.get<Room>(foModel.tables.rooms, trimmed);
  }

  const byRoomNo = applyPropertyScope(
    supabase.from(foModel.tables.rooms).select("*").eq("room_no", trimmed),
  );
  const { data: noRow, error: noError } = await byRoomNo.maybeSingle();
  if (noError) throw new Error(noError.message);
  return noRow ? toCamel<Room>(noRow) : null;
}

/** Batch-fetch rooms by id and/or room_no; map keyed by rooms.id. */
export async function fetchRoomsByRefs(
  refs: string[],
): Promise<Map<string, Room>> {
  const map = new Map<string, Room>();
  const unique = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  if (!unique.length) return map;

  const ingest = (rows: Record<string, unknown>[] | null) => {
    for (const row of rows ?? []) {
      const room = toCamel<Room>(row);
      map.set(String(room.id), room);
    }
  };

  const byIds = applyPropertyScope(
    supabase.from(foModel.tables.rooms).select("*").in("id", unique),
  );
  const { data: idRows, error: idError } = await byIds;
  if (idError) throw new Error(idError.message);
  ingest(idRows);

  const unresolved = unique.filter((ref) => !lookupRoomInMap(map, ref));
  if (unresolved.length) {
    const byRoomNos = applyPropertyScope(
      supabase.from(foModel.tables.rooms).select("*").in("room_no", unresolved),
    );
    const { data: noRows, error: noError } = await byRoomNos;
    if (noError) throw new Error(noError.message);
    ingest(noRows);
  }

  return map;
}

export function lookupRoomInMap(
  map: Map<string, Room>,
  ref: string | null | undefined,
): Room | undefined {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return undefined;

  for (const room of map.values()) {
    if (String(room.id) === trimmed) return room;
    if (String(room.roomNo ?? "") === trimmed) return room;
  }
  return undefined;
}

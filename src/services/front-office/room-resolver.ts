import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Room } from "../../types/front-office.js";
import { getActivePropertyId } from "../../utils/request-context.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueryResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: { message: string } | null;
};

type RoomQueryBuilder = {
  eq: (column: string, value: string) => RoomQueryBuilder;
  in: (column: string, values: string[]) => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
};

function roomsQuery(select: string): RoomQueryBuilder {
  const propertyId = getActivePropertyId();
  let builder = supabase.from(foModel.tables.rooms).select(select) as unknown as RoomQueryBuilder;
  if (propertyId) builder = builder.eq("property_id", propertyId);
  return builder;
}

export function isRoomUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Resolve room id or room number to rooms.id for FK storage. */
export async function resolveRoomId(
  ref: string | null | undefined,
): Promise<string | null> {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  const { data: idRow, error: idError } = await roomsQuery("id").eq("id", trimmed).maybeSingle();
  if (idError) throw new Error(idError.message);
  if (idRow && !Array.isArray(idRow) && idRow.id) return String(idRow.id);

  if (isRoomUuid(trimmed)) {
    const byFoModel = await foModel.get<Room>(foModel.tables.rooms, trimmed);
    return byFoModel ? trimmed : null;
  }

  const { data: noRow, error: noError } = await roomsQuery("id")
    .eq("room_no", trimmed)
    .maybeSingle();
  if (noError) throw new Error(noError.message);
  if (noRow && !Array.isArray(noRow) && noRow.id) return String(noRow.id);
  return null;
}

/** Load room by rooms.id or display room number. */
export async function getRoomByRef(
  ref: string | null | undefined,
): Promise<Room | null> {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  const { data: idRow, error: idError } = await roomsQuery("*").eq("id", trimmed).maybeSingle();
  if (idError) throw new Error(idError.message);
  if (idRow && !Array.isArray(idRow)) return toCamel<Room>(idRow);

  if (isRoomUuid(trimmed)) {
    return foModel.get<Room>(foModel.tables.rooms, trimmed);
  }

  const { data: noRow, error: noError } = await roomsQuery("*")
    .eq("room_no", trimmed)
    .maybeSingle();
  if (noError) throw new Error(noError.message);
  return noRow && !Array.isArray(noRow) ? toCamel<Room>(noRow) : null;
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

  const { data: idRows, error: idError } = await roomsQuery("*").in(
    "id",
    unique,
  );
  if (idError) throw new Error(idError.message);
  ingest(Array.isArray(idRows) ? idRows : idRows ? [idRows] : null);

  const unresolved = unique.filter((ref) => !lookupRoomInMap(map, ref));
  if (unresolved.length) {
    const { data: noRows, error: noError } = await roomsQuery("*").in(
      "room_no",
      unresolved,
    );
    if (noError) throw new Error(noError.message);
    ingest(Array.isArray(noRows) ? noRows : noRows ? [noRows] : null);
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

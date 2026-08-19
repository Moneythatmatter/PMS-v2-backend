import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isRoomUuid(value) {
    return UUID_RE.test(value.trim());
}
/** Resolve room number or UUID to the rooms.id UUID for FK storage. */
export async function resolveRoomId(ref) {
    const trimmed = String(ref ?? "").trim();
    if (!trimmed)
        return null;
    if (isRoomUuid(trimmed)) {
        const byId = await foModel.get(foModel.tables.rooms, trimmed);
        return byId ? trimmed : null;
    }
    const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("id")
        .eq("room_no", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data?.id ? String(data.id) : null;
}
/** Load room by UUID id or display room number. */
export async function getRoomByRef(ref) {
    const trimmed = String(ref ?? "").trim();
    if (!trimmed)
        return null;
    if (isRoomUuid(trimmed)) {
        return foModel.get(foModel.tables.rooms, trimmed);
    }
    const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("*")
        .eq("room_no", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? toCamel(data) : null;
}
/** Batch-fetch rooms by id and/or room_no; map keyed by rooms.id. */
export async function fetchRoomsByRefs(refs) {
    const map = new Map();
    const unique = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
    if (!unique.length)
        return map;
    const ids = unique.filter(isRoomUuid);
    const roomNos = unique.filter((r) => !isRoomUuid(r));
    const queries = [];
    if (ids.length) {
        queries.push((async () => {
            const { data, error } = await supabase
                .from(foModel.tables.rooms)
                .select("*")
                .in("id", ids);
            if (error)
                throw new Error(error.message);
            for (const row of data ?? []) {
                const room = toCamel(row);
                map.set(String(room.id), room);
            }
        })());
    }
    if (roomNos.length) {
        queries.push((async () => {
            const { data, error } = await supabase
                .from(foModel.tables.rooms)
                .select("*")
                .in("room_no", roomNos);
            if (error)
                throw new Error(error.message);
            for (const row of data ?? []) {
                const room = toCamel(row);
                map.set(String(room.id), room);
            }
        })());
    }
    await Promise.all(queries);
    return map;
}
export function lookupRoomInMap(map, ref) {
    const trimmed = String(ref ?? "").trim();
    if (!trimmed)
        return undefined;
    if (isRoomUuid(trimmed))
        return map.get(trimmed);
    for (const room of map.values()) {
        if (String(room.roomNo ?? "") === trimmed)
            return room;
    }
    return undefined;
}
//# sourceMappingURL=room-resolver.js.map
import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
const OPEN_MAINTENANCE_STATUSES = new Set([
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "AWAITING_VERIFICATION",
]);
function toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function parseToIsoDate(value) {
    if (!value)
        return null;
    const raw = String(value);
    const iso = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return null;
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : iso;
}
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
}
function mapBlockType(raw) {
    const t = raw.trim().toUpperCase();
    if (t === "MAINTENANCE" || t === "RENOVATION")
        return "maintenance";
    return "blocked";
}
/** Merge manual blocks + maintenance_requests that explicitly block the room. */
export async function fetchRoomAvailabilityBlocks(roomIds, rangeStart, rangeEnd) {
    const byRoom = new Map();
    const unique = [...new Set(roomIds.filter(Boolean))];
    if (!unique.length)
        return byRoom;
    const push = (block) => {
        if (!rangesOverlap(block.startDate, block.endDate, rangeStart, rangeEnd))
            return;
        const list = byRoom.get(block.roomId) ?? [];
        list.push(block);
        byRoom.set(block.roomId, list);
    };
    const { data: manualRows, error: manualErr } = await supabase
        .from("room_availability_blocks")
        .select("room_id, block_type, start_date, end_date, reason, source_type, source_id")
        .in("room_id", unique)
        .lte("start_date", rangeEnd)
        .gte("end_date", rangeStart);
    if (!manualErr) {
        for (const row of manualRows ?? []) {
            const startDate = parseToIsoDate(row.start_date);
            const endDate = parseToIsoDate(row.end_date);
            if (!startDate || !endDate)
                continue;
            push({
                roomId: String(row.room_id),
                startDate,
                endDate,
                kind: mapBlockType(String(row.block_type ?? "OUT_OF_SERVICE")),
                reason: row.reason ? String(row.reason) : undefined,
                sourceType: row.source_type ? String(row.source_type) : undefined,
                sourceId: row.source_id ? String(row.source_id) : undefined,
            });
        }
    }
    const { data: mrRows, error: mrErr } = await supabase
        .from(foModel.tables.maintenanceRequests)
        .select("id, room_id, title, status, blocks_room, reported_at, started_at, estimated_completion_at, completed_at")
        .in("room_id", unique)
        .eq("blocks_room", true);
    if (!mrErr) {
        for (const row of mrRows ?? []) {
            const status = String(row.status ?? "").toUpperCase();
            if (status === "CLOSED" || status === "CANCELLED")
                continue;
            const startDate = parseToIsoDate(row.started_at) ??
                parseToIsoDate(row.reported_at) ??
                toIsoDate(new Date());
            let endDate = parseToIsoDate(row.estimated_completion_at) ??
                parseToIsoDate(row.completed_at);
            if (!endDate) {
                if (!OPEN_MAINTENANCE_STATUSES.has(status) && status !== "")
                    continue;
                endDate = startDate;
            }
            push({
                roomId: String(row.room_id),
                startDate,
                endDate,
                kind: "maintenance",
                reason: row.title ? String(row.title) : "Maintenance",
                sourceType: "maintenance_request",
                sourceId: String(row.id),
            });
        }
    }
    return byRoom;
}
export function blockKindForDay(blocks, dayIso) {
    let kind = "none";
    for (const block of blocks) {
        if (dayIso >= block.startDate && dayIso <= block.endDate) {
            if (block.kind === "blocked")
                return "blocked";
            if (kind !== "blocked")
                kind = "maintenance";
        }
    }
    return kind;
}
export function blocksOverlapStay(blocks, checkIn, checkOut) {
    const stayEnd = checkOut;
    for (const block of blocks) {
        if (rangesOverlap(block.startDate, block.endDate, checkIn, stayEnd)) {
            return true;
        }
    }
    return false;
}
/** Flat list for API consumers (reservation picker, calendar legend). */
export async function listRoomAvailabilityBlocksForRange(rangeStart, rangeEnd) {
    const rooms = await foModel.list(foModel.tables.rooms, {
        orderBy: "room_no",
    });
    const byRoom = await fetchRoomAvailabilityBlocks(rooms.map((r) => String(r.id)), rangeStart, rangeEnd);
    const roomNoById = new Map(rooms.map((r) => [String(r.id), String(r.roomNo)]));
    const flat = [];
    for (const [roomId, blocks] of byRoom) {
        for (const block of blocks) {
            flat.push({ ...block, roomNo: roomNoById.get(roomId) });
        }
    }
    return flat;
}
//# sourceMappingURL=room-availability-blocks.js.map
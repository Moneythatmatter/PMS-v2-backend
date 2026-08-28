import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
function isHkRoomStaffFkError(message) {
    return /hk_rooms_(assigned_to|inspected_by)_fkey/i.test(message);
}
function appendStaffNote(notes, prefix, label) {
    const line = `${prefix}: ${label}`;
    const base = String(notes ?? "").trim();
    if (!base)
        return line;
    if (base.includes(line))
        return base;
    return `${base} · ${line}`;
}
/** Update/create hk_rooms with fallback when users FK is still present. */
export async function persistHkRoomRow(payload, options, staffLabels) {
    const save = async (body) => {
        if (options.mode === "create") {
            return hkModel.create(hkModel.tables.rooms, body);
        }
        return hkModel.update(hkModel.tables.rooms, options.id, body);
    };
    try {
        return await save(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isHkRoomStaffFkError(message))
            throw error;
        const fallback = { ...payload };
        let notes = payload.notes;
        if (staffLabels?.assigned) {
            fallback.assignedTo = null;
            notes = appendStaffNote(notes, "Assigned to", staffLabels.assigned);
        }
        if (staffLabels?.inspected) {
            fallback.inspectedBy = null;
            notes = appendStaffNote(notes, "Inspected by", staffLabels.inspected);
        }
        fallback.notes = notes;
        return save(fallback);
    }
}
async function fetchStaffByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(hkModel.tables.staff)
        .select("id, name")
        .in("id", unique);
    if (error)
        return map;
    for (const row of data ?? []) {
        const staff = toCamel(row);
        map.set(staff.id, staff);
    }
    return map;
}
function staffOrUserName(key, staff, users) {
    if (!key)
        return undefined;
    return (staff.get(String(key))?.name ??
        users.get(String(key))?.name ??
        String(key));
}
export function sanitizeHkRoomInput(input) {
    const body = { ...input };
    if (body.roomRefId != null && body.roomId == null) {
        body.roomId = body.roomRefId;
    }
    if (body.roomNo != null && body.roomId == null) {
        body.roomId = body.roomNo;
    }
    if (body.assignedStaff != null && body.assignedTo == null) {
        body.assignedTo = body.assignedStaff;
    }
    if (body.assignedSupervisor != null && body.inspectedBy == null) {
        body.inspectedBy = body.assignedSupervisor;
    }
    if (body.remarks != null && body.notes == null) {
        body.notes = body.remarks;
    }
    delete body.roomRefId;
    delete body.roomNo;
    delete body.category;
    delete body.type;
    delete body.bedType;
    delete body.floor;
    delete body.wing;
    delete body.maxOccupancy;
    delete body.hkStatus;
    delete body.foStatus;
    delete body.dnd;
    delete body.sleepOut;
    delete body.facilities;
    delete body.assignedStaff;
    delete body.assignedSupervisor;
    delete body.cleaningTimer;
    delete body.cleaningProgress;
    delete body.photos;
    delete body.inspectionHistory;
    delete body.guestName;
    delete body.checkoutDate;
    delete body.housekeeping;
    delete body.maintenance;
    delete body.remarks;
    delete body.updatedAt;
    delete body.createdAt;
    return body;
}
async function fetchFoRoomsByIds(ids) {
    const map = new Map();
    if (!ids.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("id, room_no, room_type, floor, bed_type, max_occupancy, is_active")
        .in("id", ids);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const room = toCamel(row);
        map.set(room.id, room);
    }
    return map;
}
async function fetchUsersByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from("users")
        .select("id, name")
        .in("id", unique);
    if (error)
        return map;
    for (const row of data ?? []) {
        const user = toCamel(row);
        map.set(user.id, user);
    }
    return map;
}
async function resolveRoomId(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await foModel.get(foModel.tables.rooms, trimmed);
    if (byId?.id)
        return byId.id;
    const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("id")
        .eq("room_no", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data?.id ? String(data.id) : null;
}
export async function resolveHkRoomId(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await hkModel.get(hkModel.tables.rooms, trimmed);
    if (byId?.id)
        return byId.id;
    const roomId = await resolveRoomId(trimmed);
    if (!roomId)
        return null;
    const { data, error } = await supabase
        .from(hkModel.tables.rooms)
        .select("id")
        .eq("room_id", roomId)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data?.id ? String(data.id) : null;
}
function applyEnrichment(row, room, staff = new Map(), users = new Map()) {
    return {
        ...row,
        roomNo: room?.roomNo ?? row.roomNo,
        roomType: room?.roomType ?? row.roomType,
        floor: room?.floor ?? row.floor,
        bedType: room?.bedType ?? row.bedType,
        maxOccupancy: room?.maxOccupancy ?? row.maxOccupancy,
        isActive: room?.isActive ?? row.isActive,
        assignedToName: staffOrUserName(row.assignedTo, staff, users),
        inspectedByName: staffOrUserName(row.inspectedBy, staff, users),
    };
}
export async function enrichHkRoom(row) {
    const roomId = String(row.roomId ?? "");
    const staffIds = [row.assignedTo, row.inspectedBy].filter(Boolean).map(String);
    const [roomMap, staffMap, userMap] = await Promise.all([
        roomId ? fetchFoRoomsByIds([roomId]) : Promise.resolve(new Map()),
        fetchStaffByIds(staffIds),
        fetchUsersByIds(staffIds),
    ]);
    return applyEnrichment(row, roomMap.get(roomId), staffMap, userMap);
}
export async function enrichHkRooms(rows) {
    if (!rows.length)
        return [];
    const roomIds = [...new Set(rows.map((r) => String(r.roomId)).filter(Boolean))];
    const staffIds = [
        ...new Set(rows
            .flatMap((r) => [r.assignedTo, r.inspectedBy])
            .filter(Boolean)
            .map(String)),
    ];
    const [roomMap, staffMap, userMap] = await Promise.all([
        fetchFoRoomsByIds(roomIds),
        fetchStaffByIds(staffIds),
        fetchUsersByIds(staffIds),
    ]);
    return rows.map((row) => applyEnrichment(row, roomMap.get(String(row.roomId)), staffMap, userMap));
}
export { resolveRoomId };
//# sourceMappingURL=hk-room-enrich.js.map
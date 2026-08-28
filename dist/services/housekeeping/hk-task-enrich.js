import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import { resolveGuestRequestAssignee, resolveGuestRequestAssigneeLabel, } from "./guest-request-enrich.js";
import { computeHkTaskOverdue } from "../../types/housekeeping.js";
export const resolveHkTaskAssignee = resolveGuestRequestAssignee;
export const resolveHkTaskAssigneeLabel = resolveGuestRequestAssigneeLabel;
function isHkTaskStaffFkError(message) {
    return /housekeeping_tasks_(assigned_to|created_by|approved_by)_fkey/i.test(message);
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
/** Update/create tasks with fallback when users FK is still present. */
export async function persistHkTaskRow(payload, options, staffLabels) {
    const save = async (body) => {
        if (options.mode === "create") {
            return hkModel.create(hkModel.tables.tasks, body);
        }
        return hkModel.update(hkModel.tables.tasks, options.id, body);
    };
    try {
        return await save(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isHkTaskStaffFkError(message))
            throw error;
        const fallback = { ...payload };
        let notes = payload.notes;
        if (staffLabels?.assigned) {
            fallback.assignedTo = null;
            notes = appendStaffNote(notes, "Assigned to", staffLabels.assigned);
        }
        if (staffLabels?.created) {
            fallback.createdBy = null;
            notes = appendStaffNote(notes, "Created by", staffLabels.created);
        }
        if (staffLabels?.approved) {
            fallback.approvedBy = null;
            notes = appendStaffNote(notes, "Approved by", staffLabels.approved);
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
export function sanitizeHkTaskInput(input) {
    const body = { ...input };
    if (body.roomRefId != null && body.roomId == null) {
        body.roomId = body.roomRefId;
    }
    if (body.roomNo != null && body.roomId == null) {
        body.roomId = body.roomNo;
    }
    if (body.reservationId != null && body.bookingId == null) {
        body.bookingId = body.reservationId;
    }
    if (body.assignedStaff != null && body.assignedTo == null) {
        body.assignedTo = body.assignedStaff;
    }
    if (body.remarks != null && body.notes == null) {
        body.notes = body.remarks;
    }
    delete body.roomRefId;
    delete body.roomNo;
    delete body.reservationId;
    delete body.assignedStaff;
    delete body.remarks;
    delete body.taskNumber;
    delete body.roomIds;
    delete body.updatedAt;
    delete body.createdAt;
    return body;
}
function combineDateAndTime(date, time) {
    const d = String(date ?? "").trim();
    const t = String(time ?? "").trim();
    if (!d || !t)
        return null;
    const normalized = t.length === 5 ? `${t}:00` : t;
    return `${d}T${normalized}`;
}
export function parseHkTaskScheduleInput(input) {
    const scheduledDate = (typeof input.scheduledDate === "string" ? input.scheduledDate : null) ??
        (typeof input.cleaningDate === "string" ? input.cleaningDate : null);
    let scheduledStartAt = typeof input.scheduledStartAt === "string" ? input.scheduledStartAt : null;
    let dueAt = typeof input.dueAt === "string" ? input.dueAt : null;
    const startTime = typeof input.startTime === "string"
        ? input.startTime
        : typeof input.scheduleStartTime === "string"
            ? input.scheduleStartTime
            : null;
    const dueTime = typeof input.dueTime === "string"
        ? input.dueTime
        : typeof input.scheduleEndTime === "string"
            ? input.scheduleEndTime
            : null;
    if (!scheduledStartAt && scheduledDate && startTime) {
        scheduledStartAt = combineDateAndTime(scheduledDate, startTime);
    }
    if (!dueAt && scheduledDate && dueTime) {
        dueAt = combineDateAndTime(scheduledDate, dueTime);
    }
    return {
        scheduledDate,
        scheduledStartAt,
        dueAt,
    };
}
export function buildHkTaskSchedulePayload(input) {
    const payload = {};
    if (input.scheduledDate)
        payload.scheduledDate = input.scheduledDate;
    if (input.scheduledStartAt)
        payload.scheduledStartAt = input.scheduledStartAt;
    if (input.dueAt)
        payload.dueAt = input.dueAt;
    return payload;
}
async function fetchRoomsByIds(ids) {
    const map = new Map();
    if (!ids.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.rooms)
        .select("id, room_no")
        .in("id", ids);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const room = toCamel(row);
        map.set(room.id, room);
    }
    return map;
}
async function fetchBookingsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.reservations)
        .select("id, booking_no")
        .in("id", unique);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const booking = toCamel(row);
        map.set(booking.id, booking);
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
async function fetchGuestRequestsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(hkModel.tables.guestRequests)
        .select("id, request_number, description")
        .in("id", unique);
    if (error)
        return map;
    for (const row of data ?? []) {
        const request = toCamel(row);
        map.set(request.id, request);
    }
    return map;
}
function applyEnrichment(row, room, booking, staff = new Map(), users = new Map(), guestRequest) {
    const enriched = {
        ...row,
        roomNo: room?.roomNo ?? row.roomNo,
        bookingNo: booking?.bookingNo ?? row.bookingNo,
        assignedToName: staffOrUserName(row.assignedTo, staff, users),
        createdByName: staffOrUserName(row.createdBy, staff, users),
        approvedByName: staffOrUserName(row.approvedBy, staff, users),
        requestNumber: guestRequest?.requestNumber ?? row.requestNumber,
        requestDescription: guestRequest?.description ?? row.requestDescription,
    };
    return {
        ...enriched,
        isOverdue: computeHkTaskOverdue(enriched),
    };
}
export async function enrichHkTask(row) {
    const roomId = String(row.roomId ?? "");
    const bookingId = row.bookingId ? String(row.bookingId) : "";
    const requestId = row.requestId ? String(row.requestId) : "";
    const staffIds = [row.assignedTo, row.createdBy, row.approvedBy]
        .filter(Boolean)
        .map(String);
    const [roomMap, bookingMap, staffMap, userMap, requestMap] = await Promise.all([
        roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
        bookingId ? fetchBookingsByIds([bookingId]) : Promise.resolve(new Map()),
        fetchStaffByIds(staffIds),
        fetchUsersByIds(staffIds),
        requestId ? fetchGuestRequestsByIds([requestId]) : Promise.resolve(new Map()),
    ]);
    return applyEnrichment(row, roomMap.get(roomId), bookingId ? bookingMap.get(bookingId) : undefined, staffMap, userMap, requestId ? requestMap.get(requestId) : undefined);
}
export async function enrichHkTasks(rows) {
    if (!rows.length)
        return [];
    const roomIds = [...new Set(rows.map((r) => String(r.roomId)).filter(Boolean))];
    const bookingIds = [
        ...new Set(rows.map((r) => String(r.bookingId ?? "")).filter(Boolean)),
    ];
    const requestIds = [
        ...new Set(rows.map((r) => String(r.requestId ?? "")).filter(Boolean)),
    ];
    const staffIds = [
        ...new Set(rows
            .flatMap((r) => [r.assignedTo, r.createdBy, r.approvedBy])
            .filter(Boolean)
            .map(String)),
    ];
    const [roomMap, bookingMap, staffMap, userMap, requestMap] = await Promise.all([
        fetchRoomsByIds(roomIds),
        fetchBookingsByIds(bookingIds),
        fetchStaffByIds(staffIds),
        fetchUsersByIds(staffIds),
        fetchGuestRequestsByIds(requestIds),
    ]);
    return rows.map((row) => applyEnrichment(row, roomMap.get(String(row.roomId)), row.bookingId ? bookingMap.get(String(row.bookingId)) : undefined, staffMap, userMap, row.requestId ? requestMap.get(String(row.requestId)) : undefined));
}
export async function resolveHkTaskId(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await hkModel.get(hkModel.tables.tasks, trimmed);
    if (byId?.id)
        return byId.id;
    const { data, error } = await supabase
        .from(hkModel.tables.tasks)
        .select("id")
        .eq("task_number", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data?.id ? String(data.id) : null;
}
export async function resolveRoomIdForTask(key) {
    return resolveRoomId(key);
}
//# sourceMappingURL=hk-task-enrich.js.map
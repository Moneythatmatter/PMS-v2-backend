import { hkModel } from "../../models/housekeeping/index.js";
import { enrichHkRoom, enrichHkRooms, resolveHkRoomId, resolveRoomId, sanitizeHkRoomInput, } from "../../services/housekeeping/hk-room-enrich.js";
import { normalizeHkRoomStatus, } from "../../types/housekeeping.js";
import { fail, fromError, ok } from "../../utils/response.js";
async function appendHistory(entry) {
    await hkModel.create(hkModel.tables.history, {
        id: hkModel.newId("H"),
        timestamp: new Date().toISOString(),
        ...entry,
    });
}
async function getEnrichedOr404(id) {
    const row = await hkModel.get(hkModel.tables.rooms, id);
    if (!row)
        return null;
    return enrichHkRoom(row);
}
export async function listRooms(req, res) {
    try {
        const status = req.query.status;
        const filters = {};
        if (status)
            filters.status = normalizeHkRoomStatus(status);
        const rows = await enrichHkRooms(await hkModel.list(hkModel.tables.rooms, {
            filters,
            orderBy: "updated_at",
            ascending: false,
        }));
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getRoom(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const row = await getEnrichedOr404(id);
        if (!row)
            return fail(res, "Room not found", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createRoom(req, res) {
    try {
        let body = sanitizeHkRoomInput(req.body);
        const roomKey = String(body.roomId ?? "").trim();
        if (!roomKey)
            return fail(res, "roomId (FO rooms.id or room_no) is required", 400);
        const roomId = (await resolveRoomId(roomKey)) ?? roomKey;
        if (!body.id)
            body.id = hkModel.newId();
        body.roomId = roomId;
        if (!body.status)
            body.status = "DIRTY";
        body.status = normalizeHkRoomStatus(body.status);
        const row = await enrichHkRoom(await hkModel.create(hkModel.tables.rooms, body));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateRoom(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        let body = sanitizeHkRoomInput(req.body);
        delete body.id;
        delete body.roomId;
        if (body.status != null) {
            body.status = normalizeHkRoomStatus(body.status);
        }
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, body));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteRoom(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        await hkModel.remove(hkModel.tables.rooms, id);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Assign cleaner — status → INSPECTING. */
export async function startClean(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const existing = await getEnrichedOr404(id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const assignedTo = String(req.body?.assignedTo ??
            req.body?.assignedStaff ??
            existing.assignedTo ??
            "").trim() || null;
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, {
            status: "INSPECTING",
            assignedTo,
        }));
        await appendHistory({
            user: assignedTo ?? "Unassigned",
            category: "Cleaning",
            action: "Started cleaning",
            room: existing.roomNo ?? id,
            details: `Cleaning started`,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Pause/resume — notes only (no timer column in slim schema). */
export async function pauseClean(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const existing = await getEnrichedOr404(id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const paused = Boolean(req.body?.paused);
        const note = paused ? "Cleaning paused." : "Cleaning resumed.";
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, {
            notes: [existing.notes, note].filter(Boolean).join(" ").trim(),
        }));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Cleaning finished — awaiting inspection. */
export async function completeClean(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const existing = await getEnrichedOr404(id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const body = req.body ?? {};
        const notes = String(body.notes ?? body.remarks ?? existing.notes ?? "").trim();
        const now = new Date().toISOString();
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, {
            status: "INSPECTING",
            lastCleanedAt: now,
            notes: notes || "Cleaning completed — awaiting inspection.",
        }));
        await appendHistory({
            user: String(existing.assignedToName ?? existing.assignedTo ?? "Housekeeper"),
            category: "Cleaning",
            action: "Cleaning completed",
            room: existing.roomNo ?? id,
            details: "Ready for supervisor inspection",
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Supervisor pass / fail inspection. */
export async function inspectRoom(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const existing = await getEnrichedOr404(id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const body = req.body ?? {};
        const passed = (body.result ?? "Passed") === "Passed";
        const inspector = String(body.inspectedBy ?? body.inspector ?? existing.inspectedBy ?? "Supervisor").trim();
        const now = new Date().toISOString();
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, {
            status: passed ? "INSPECTED" : "DIRTY",
            inspectedBy: inspector || null,
            lastInspectedAt: now,
            notes: body.remarks ?? existing.notes,
        }));
        await appendHistory({
            user: inspector,
            category: "Inspection",
            action: passed ? "Inspection passed" : "Inspection rejected",
            room: existing.roomNo ?? id,
            details: body.remarks ?? (passed ? "Passed" : "Rejected"),
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Mark room dirty (checkout / stay-over). */
export async function markDirty(req, res) {
    try {
        const id = await resolveHkRoomId(String(req.params.id));
        if (!id)
            return fail(res, "Room not found", 404);
        const existing = await getEnrichedOr404(id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const row = await enrichHkRoom(await hkModel.update(hkModel.tables.rooms, id, {
            status: "DIRTY",
            assignedTo: null,
        }));
        await appendHistory({
            user: String(req.body?.user ?? "System"),
            category: "Room Status",
            action: "Marked dirty",
            room: existing.roomNo ?? id,
            details: "Room marked dirty",
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=rooms.js.map
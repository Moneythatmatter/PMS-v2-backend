import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
async function appendHistory(entry) {
    await hkModel.create(hkModel.tables.history, {
        id: hkModel.newId("H"),
        timestamp: new Date().toISOString(),
        ...entry,
    });
}
export async function listRooms(req, res) {
    try {
        const floor = req.query.floor;
        const hkStatus = req.query.hkStatus;
        const status = req.query.status;
        const filters = {
            floor,
            hk_status: hkStatus,
            status,
        };
        const rows = await hkModel.list(hkModel.tables.rooms, {
            filters,
            orderBy: "id",
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getRoom(req, res) {
    try {
        const row = await hkModel.get(hkModel.tables.rooms, String(req.params.id));
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
        const body = { ...req.body };
        if (!body.id)
            body.id = String(body.roomNo ?? hkModel.newId("RM"));
        if (!body.roomNo)
            body.roomNo = body.id;
        if (!body.hkStatus)
            body.hkStatus = "Dirty";
        if (!body.status)
            body.status = "Vacant Dirty";
        if (!body.foStatus)
            body.foStatus = "Vacant";
        const row = await hkModel.create(hkModel.tables.rooms, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateRoom(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const row = await hkModel.update(hkModel.tables.rooms, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteRoom(req, res) {
    try {
        await hkModel.remove(hkModel.tables.rooms, String(req.params.id));
        return ok(res, { id: req.params.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Assign housekeeper and mark room as Cleaning. */
export async function startClean(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.rooms, id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const staff = String(req.body?.assignedStaff ??
            existing.assignedStaff ??
            "Unassigned");
        const now = new Date().toISOString();
        const row = await hkModel.update(hkModel.tables.rooms, id, {
            hkStatus: "Cleaning",
            status: "Cleaning",
            assignedStaff: staff,
            cleaningProgress: 0,
            cleaningTimer: {
                startedAt: now,
                elapsedSeconds: 0,
                paused: false,
                lastTick: now,
            },
        });
        await appendHistory({
            user: staff,
            category: "Cleaning",
            action: "Started cleaning",
            room: String(existing.roomNo ?? id),
            details: `Cleaning started by ${staff}`,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Pause / resume cleaning timer. */
export async function pauseClean(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.rooms, id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const timer = existing.cleaningTimer ?? {};
        const paused = Boolean(req.body?.paused ?? !timer.paused);
        const now = new Date().toISOString();
        let elapsed = Number(timer.elapsedSeconds ?? 0);
        if (!paused && timer.lastTick) {
            // no-op on resume; client tracks ticks — just flip flag
        }
        else if (paused && timer.lastTick) {
            const last = new Date(String(timer.lastTick)).getTime();
            if (!Number.isNaN(last)) {
                elapsed += Math.max(0, Math.floor((Date.now() - last) / 1000));
            }
        }
        const row = await hkModel.update(hkModel.tables.rooms, id, {
            cleaningTimer: {
                ...timer,
                paused,
                elapsedSeconds: elapsed,
                lastTick: now,
            },
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Mark cleaning done → Inspection Pending. */
export async function completeClean(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.rooms, id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const body = req.body ?? {};
        const supervisor = String(body.assignedSupervisor ?? existing.assignedSupervisor ?? "Supervisor");
        const row = await hkModel.update(hkModel.tables.rooms, id, {
            hkStatus: "Cleaning",
            status: "Inspection Pending",
            assignedSupervisor: supervisor,
            cleaningProgress: 100,
            photos: body.photos ?? existing.photos ?? [],
            remarks: body.remarks ?? existing.remarks,
        });
        await appendHistory({
            user: String(existing.assignedStaff ?? "Housekeeper"),
            category: "Cleaning",
            action: "Cleaning completed",
            room: String(existing.roomNo ?? id),
            details: "Room ready for supervisor inspection",
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
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.rooms, id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const body = req.body ?? {};
        const result = body.result ?? "Passed";
        const inspector = body.inspector ?? String(existing.assignedSupervisor ?? "Supervisor");
        const now = new Date();
        const historyEntry = {
            id: hkModel.newId("INS"),
            date: now.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
            }),
            time: now.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
            }),
            inspector,
            supervisor: inspector,
            result,
            qualityScore: Number(body.qualityScore ?? (result === "Passed" ? 95 : 70)),
            remarks: body.remarks ?? "",
            signature: body.signature ?? inspector,
        };
        const prevHistory = Array.isArray(existing.inspectionHistory)
            ? existing.inspectionHistory
            : [];
        const passed = result === "Passed";
        const row = await hkModel.update(hkModel.tables.rooms, id, {
            hkStatus: passed ? "Inspected" : "Dirty",
            status: passed ? "Vacant Ready" : "Vacant Dirty",
            foStatus: passed ? "Vacant" : existing.foStatus,
            cleaningTimer: null,
            cleaningProgress: passed ? 100 : 0,
            inspectionHistory: [historyEntry, ...prevHistory],
            remarks: body.remarks ?? existing.remarks,
        });
        await appendHistory({
            user: inspector,
            category: "Inspection",
            action: passed ? "Inspection passed" : "Inspection rejected",
            room: String(existing.roomNo ?? id),
            details: historyEntry.remarks || `Quality score ${historyEntry.qualityScore}`,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Mark room dirty (e.g. after checkout / stay-over). */
export async function markDirty(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.rooms, id);
        if (!existing)
            return fail(res, "Room not found", 404);
        const occupied = String(existing.foStatus) === "Occupied";
        const row = await hkModel.update(hkModel.tables.rooms, id, {
            hkStatus: "Dirty",
            status: occupied ? "Occupied Dirty" : "Vacant Dirty",
            cleaningTimer: null,
            cleaningProgress: 0,
            assignedStaff: null,
        });
        await appendHistory({
            user: String(req.body?.user ?? "System"),
            category: "Room Status",
            action: "Marked dirty",
            room: String(existing.roomNo ?? id),
            details: occupied ? "Stay-over / occupied dirty" : "Vacant dirty",
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=rooms.js.map
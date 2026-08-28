import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import { enrichHkTask, enrichHkTasks, buildHkTaskSchedulePayload, parseHkTaskScheduleInput, persistHkTaskRow, resolveHkTaskAssignee, resolveHkTaskAssigneeLabel, resolveHkTaskId, resolveRoomIdForTask, sanitizeHkTaskInput, } from "./hk-task-enrich.js";
import { persistHkRoomRow, resolveHkRoomId } from "./hk-room-enrich.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { normalizeHkTaskPriority, normalizeHkTaskStatus, normalizeHkTaskType, } from "../../types/housekeeping.js";
const ACTIVE_STATUSES = [
    "PENDING",
    "ASSIGNED",
    "IN_PROGRESS",
    "PENDING_INSPECTION",
];
async function applySchedulePatch(taskId, schedule) {
    const payload = buildHkTaskSchedulePayload(schedule);
    if (!Object.keys(payload).length)
        return;
    await hkModel.update(hkModel.tables.tasks, taskId, payload);
}
async function getTaskOrThrow(id) {
    const row = await hkModel.get(hkModel.tables.tasks, id);
    if (!row)
        throw new NotFoundError("Task not found");
    return row;
}
async function syncHkRoomForTask(roomId, patch, staffLabels) {
    const hkRoomId = await resolveHkRoomId(roomId);
    if (hkRoomId) {
        await persistHkRoomRow(patch, { mode: "update", id: hkRoomId }, staffLabels);
        return;
    }
    await persistHkRoomRow({
        roomId,
        status: patch.status ?? "DIRTY",
        ...patch,
    }, { mode: "create" }, staffLabels);
}
async function appendHistory(entry) {
    await hkModel.create(hkModel.tables.history, {
        id: hkModel.newId("H"),
        timestamp: new Date().toISOString(),
        ...entry,
    });
}
export const HkTaskService = {
    async list(filters = {}) {
        const queryFilters = {};
        if (filters.status)
            queryFilters.status = normalizeHkTaskStatus(filters.status);
        if (filters.taskType)
            queryFilters.task_type = normalizeHkTaskType(filters.taskType);
        let rows = await hkModel.list(hkModel.tables.tasks, {
            filters: queryFilters,
            orderBy: "created_at",
            ascending: false,
        });
        if (filters.roomId) {
            const roomId = (await resolveRoomIdForTask(filters.roomId)) ?? filters.roomId;
            rows = rows.filter((r) => String(r.roomId) === roomId);
        }
        if (filters.bookingId) {
            rows = rows.filter((r) => String(r.bookingId) === filters.bookingId);
        }
        return enrichHkTasks(rows);
    },
    async get(id) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        return enrichHkTask(await getTaskOrThrow(resolved));
    },
    async findActiveForRoom(roomKey) {
        const roomId = await resolveRoomIdForTask(roomKey);
        if (!roomId)
            return null;
        const { data, error } = await supabase
            .from(hkModel.tables.tasks)
            .select("*")
            .eq("room_id", roomId)
            .in("status", ACTIVE_STATUSES)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error)
            throw new AppError(error.message);
        if (!data)
            return null;
        const row = data;
        const task = {
            id: String(row.id),
            taskNumber: row.task_number,
            roomId: String(row.room_id),
            bookingId: row.booking_id,
            taskType: normalizeHkTaskType(row.task_type),
            status: normalizeHkTaskStatus(row.status),
            assignedTo: row.assigned_to,
            createdBy: row.created_by,
            priority: normalizeHkTaskPriority(row.priority),
            notes: row.notes,
            assignedAt: row.assigned_at,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            approvedAt: row.approved_at,
            approvedBy: row.approved_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
        return enrichHkTask(task);
    },
    async create(input) {
        let body = sanitizeHkTaskInput(input);
        const schedule = parseHkTaskScheduleInput(input);
        const roomKey = String(body.roomId ?? "").trim();
        if (!roomKey)
            throw new AppError("roomId is required", 400);
        const roomId = (await resolveRoomIdForTask(roomKey)) ?? roomKey;
        body.roomId = roomId;
        if (!body.id)
            body.id = hkModel.newId();
        if (!body.taskType)
            body.taskType = "REGULAR_CLEANING";
        body.taskType = normalizeHkTaskType(body.taskType);
        if (!body.status)
            body.status = "PENDING";
        body.status = normalizeHkTaskStatus(body.status);
        if (!body.priority)
            body.priority = "MEDIUM";
        body.priority = normalizeHkTaskPriority(body.priority);
        if (body.bookingId === "")
            body.bookingId = null;
        if (body.requestId === "")
            body.requestId = null;
        if (!schedule.scheduledDate && schedule.scheduledStartAt) {
            schedule.scheduledDate = schedule.scheduledStartAt.slice(0, 10);
        }
        if (!schedule.scheduledDate && schedule.dueAt) {
            schedule.scheduledDate = schedule.dueAt.slice(0, 10);
        }
        Object.assign(body, buildHkTaskSchedulePayload(schedule));
        let row;
        const { data: rpcId, error: rpcError } = await supabase.rpc("hk_create_task", {
            p_room_id: roomId,
            p_booking_id: body.bookingId ?? null,
            p_task_type: body.taskType,
            p_status: body.status,
            p_priority: body.priority,
            p_notes: body.notes ?? null,
            p_assigned_to: body.assignedTo ?? null,
            p_created_by: body.createdBy ?? null,
        });
        if (!rpcError && rpcId) {
            await applySchedulePatch(String(rpcId), schedule);
            row = await this.get(String(rpcId));
        }
        else if (rpcError &&
            /hk_create_task|Could not find the function/i.test(rpcError.message)) {
            row = await enrichHkTask(await hkModel.create(hkModel.tables.tasks, body));
            if (body.status === "PENDING" && body.taskType !== "INSPECTION") {
                await syncHkRoomForTask(roomId, { status: "DIRTY" });
            }
            return row;
        }
        else if (rpcError) {
            throwIfRlsError(rpcError.message);
        }
        else {
            row = await enrichHkTask(await hkModel.create(hkModel.tables.tasks, body));
        }
        return row;
    },
    /** Called from checkout fallback when RPC is unavailable. */
    async onCheckout(options) {
        const roomId = (await resolveRoomIdForTask(options.roomId)) ?? options.roomId;
        if (!roomId)
            return null;
        const { data, error } = await supabase.rpc("hk_create_checkout_task", {
            p_room_id: roomId,
            p_booking_id: options.bookingId,
            p_notes: options.notes ?? null,
            p_created_by: options.createdBy ?? null,
        });
        if (error) {
            if (/hk_create_checkout_task|Could not find the function/i.test(error.message)) {
                await syncHkRoomForTask(roomId, { status: "DIRTY" });
                return this.create({
                    roomId,
                    bookingId: options.bookingId,
                    taskType: "CHECKOUT_CLEANING",
                    status: "PENDING",
                    priority: "HIGH",
                    notes: options.notes ?? "Auto-created on guest checkout",
                    createdBy: options.createdBy,
                });
            }
            throw new AppError(error.message);
        }
        const taskId = data ? String(data) : null;
        if (!taskId)
            return null;
        return this.get(taskId);
    },
    async assign(id, assignedTo) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        const existing = await getTaskOrThrow(resolved);
        if (!["PENDING", "ASSIGNED"].includes(existing.status)) {
            throw new ConflictError(`Cannot assign task in status ${existing.status}`);
        }
        const assigneeRaw = assignedTo.trim();
        const assigneeLabel = (await resolveHkTaskAssigneeLabel(assigneeRaw)) || assigneeRaw;
        const resolvedAssignee = assigneeRaw
            ? await resolveHkTaskAssignee(assigneeRaw)
            : null;
        const now = new Date().toISOString();
        const row = await enrichHkTask(await persistHkTaskRow({
            status: "ASSIGNED",
            assignedTo: resolvedAssignee,
            assignedAt: now,
        }, { mode: "update", id: resolved }, { assigned: assigneeLabel || undefined }));
        await syncHkRoomForTask(existing.roomId, {
            status: "DIRTY",
            assignedTo: resolvedAssignee,
        }, { assigned: assigneeLabel || undefined });
        await appendHistory({
            user: assigneeLabel || assignedTo,
            category: "Cleaning",
            action: "Task assigned",
            room: row.roomNo ?? existing.roomId,
            details: `${row.taskNumber ?? resolved} assigned`,
        });
        return row;
    },
    async start(id) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        const existing = await getTaskOrThrow(resolved);
        if (!["PENDING", "ASSIGNED"].includes(existing.status)) {
            throw new ConflictError(`Cannot start task in status ${existing.status}`);
        }
        const now = new Date().toISOString();
        const patch = {
            status: "IN_PROGRESS",
            startedAt: now,
        };
        if (!existing.assignedAt && existing.assignedTo) {
            patch.assignedAt = now;
        }
        const row = await enrichHkTask(await hkModel.update(hkModel.tables.tasks, resolved, patch));
        const assigneeLabel = existing.assignedTo
            ? (await resolveHkTaskAssigneeLabel(existing.assignedTo)) ||
                row.assignedToName
            : undefined;
        await syncHkRoomForTask(existing.roomId, {
            status: "INSPECTING",
            assignedTo: existing.assignedTo ?? null,
        }, assigneeLabel ? { assigned: assigneeLabel } : undefined);
        await appendHistory({
            user: String(existing.assignedTo ?? "Housekeeper"),
            category: "Cleaning",
            action: "Task started",
            room: row.roomNo ?? existing.roomId,
            details: `${row.taskNumber ?? resolved} in progress`,
        });
        return row;
    },
    async complete(id, notes) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        const existing = await getTaskOrThrow(resolved);
        if (existing.status !== "IN_PROGRESS") {
            throw new ConflictError(`Cannot complete task in status ${existing.status}`);
        }
        const now = new Date().toISOString();
        const row = await enrichHkTask(await hkModel.update(hkModel.tables.tasks, resolved, {
            status: "PENDING_INSPECTION",
            completedAt: now,
            notes: notes ?? existing.notes,
        }));
        await syncHkRoomForTask(existing.roomId, {
            status: "INSPECTING",
            lastCleanedAt: now,
        });
        await appendHistory({
            user: String(existing.assignedTo ?? "Housekeeper"),
            category: "Cleaning",
            action: "Task completed",
            room: row.roomNo ?? existing.roomId,
            details: `${row.taskNumber ?? resolved} pending inspection`,
        });
        return row;
    },
    async approve(id, approvedBy) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        const existing = await getTaskOrThrow(resolved);
        if (existing.status !== "PENDING_INSPECTION" &&
            existing.status !== "COMPLETED") {
            throw new ConflictError(`Cannot approve task in status ${existing.status}`);
        }
        const approverRaw = approvedBy.trim();
        const approverLabel = (await resolveHkTaskAssigneeLabel(approverRaw)) || approverRaw;
        const resolvedApprover = approverRaw
            ? await resolveHkTaskAssignee(approverRaw)
            : null;
        const now = new Date().toISOString();
        const row = await enrichHkTask(await persistHkTaskRow({
            status: "APPROVED",
            approvedAt: now,
            approvedBy: resolvedApprover,
        }, { mode: "update", id: resolved }, { approved: approverLabel || undefined }));
        await syncHkRoomForTask(existing.roomId, {
            status: "CLEAN",
            lastInspectedAt: now,
            inspectedBy: resolvedApprover,
            assignedTo: null,
        }, { inspected: approverLabel || undefined });
        await appendHistory({
            user: approverLabel || approvedBy,
            category: "Inspection",
            action: "Task approved",
            room: row.roomNo ?? existing.roomId,
            details: `${row.taskNumber ?? resolved} approved — room clean`,
        });
        return row;
    },
    async cancel(id, notes) {
        const resolved = await resolveHkTaskId(id);
        if (!resolved)
            throw new NotFoundError("Task not found");
        const existing = await getTaskOrThrow(resolved);
        if (existing.status === "APPROVED") {
            throw new ConflictError("Cannot cancel an approved task");
        }
        return enrichHkTask(await hkModel.update(hkModel.tables.tasks, resolved, {
            status: "CANCELLED",
            notes: notes ?? existing.notes,
        }));
    },
};
//# sourceMappingURL=hk-task.service.js.map
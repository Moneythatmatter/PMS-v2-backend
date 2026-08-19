import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import {
  enrichHkTask,
  enrichHkTasks,
  resolveHkTaskId,
  resolveRoomIdForTask,
  sanitizeHkTaskInput,
} from "./hk-task-enrich.js";
import { resolveHkRoomId } from "./hk-room-enrich.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import {
  normalizeHkTaskPriority,
  normalizeHkTaskStatus,
  normalizeHkTaskType,
  type HkTask,
  type HkTaskStatus,
} from "../../types/housekeeping.js";

const ACTIVE_STATUSES: HkTaskStatus[] = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
];

async function getTaskOrThrow(id: string): Promise<HkTask> {
  const row = await hkModel.get<HkTask>(hkModel.tables.tasks, id);
  if (!row) throw new NotFoundError("Task not found");
  return row;
}

async function syncHkRoomForTask(
  roomId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const hkRoomId = await resolveHkRoomId(roomId);
  if (hkRoomId) {
    await hkModel.update(hkModel.tables.rooms, hkRoomId, patch);
    return;
  }

  await hkModel.create(hkModel.tables.rooms, {
    roomId,
    status: patch.status ?? "DIRTY",
    ...patch,
  });
}

async function appendHistory(entry: {
  user: string;
  category: string;
  action: string;
  room?: string;
  details: string;
}) {
  await hkModel.create(hkModel.tables.history, {
    id: hkModel.newId("H"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

export const HkTaskService = {
  async list(filters: {
    status?: string;
    roomId?: string;
    bookingId?: string;
    taskType?: string;
  } = {}): Promise<HkTask[]> {
    const queryFilters: Record<string, string | undefined> = {};
    if (filters.status) queryFilters.status = normalizeHkTaskStatus(filters.status);
    if (filters.taskType) queryFilters.task_type = normalizeHkTaskType(filters.taskType);

    let rows = await hkModel.list<HkTask>(hkModel.tables.tasks, {
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

  async get(id: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    return enrichHkTask(await getTaskOrThrow(resolved));
  },

  async findActiveForRoom(roomKey: string): Promise<HkTask | null> {
    const roomId = await resolveRoomIdForTask(roomKey);
    if (!roomId) return null;

    const { data, error } = await supabase
      .from(hkModel.tables.tasks)
      .select("*")
      .eq("room_id", roomId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new AppError(error.message);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const task: HkTask = {
      id: String(row.id),
      taskNumber: row.task_number as string | undefined,
      roomId: String(row.room_id),
      bookingId: row.booking_id as string | null | undefined,
      taskType: normalizeHkTaskType(row.task_type),
      status: normalizeHkTaskStatus(row.status),
      assignedTo: row.assigned_to as string | null | undefined,
      createdBy: row.created_by as string | null | undefined,
      priority: normalizeHkTaskPriority(row.priority),
      notes: row.notes as string | null | undefined,
      assignedAt: row.assigned_at as string | null | undefined,
      startedAt: row.started_at as string | null | undefined,
      completedAt: row.completed_at as string | null | undefined,
      approvedAt: row.approved_at as string | null | undefined,
      approvedBy: row.approved_by as string | null | undefined,
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
    return enrichHkTask(task);
  },

  async create(input: Record<string, unknown>): Promise<HkTask> {
    let body = sanitizeHkTaskInput(input);
    const roomKey = String(body.roomId ?? "").trim();
    if (!roomKey) throw new AppError("roomId is required", 400);

    const roomId = (await resolveRoomIdForTask(roomKey)) ?? roomKey;
    body.roomId = roomId;
    if (!body.id) body.id = hkModel.newId();
    if (!body.taskType) body.taskType = "REGULAR_CLEANING";
    body.taskType = normalizeHkTaskType(body.taskType);
    if (!body.status) body.status = "PENDING";
    body.status = normalizeHkTaskStatus(body.status);
    if (!body.priority) body.priority = "MEDIUM";
    body.priority = normalizeHkTaskPriority(body.priority);

    if (body.bookingId === "") body.bookingId = null;

    let row: HkTask;

    const { data: rpcId, error: rpcError } = await supabase.rpc("hk_create_task", {
      p_room_id: roomId,
      p_booking_id: (body.bookingId as string | null | undefined) ?? null,
      p_task_type: body.taskType,
      p_status: body.status,
      p_priority: body.priority,
      p_notes: (body.notes as string | null | undefined) ?? null,
      p_assigned_to: (body.assignedTo as string | null | undefined) ?? null,
      p_created_by: (body.createdBy as string | null | undefined) ?? null,
    });

    if (!rpcError && rpcId) {
      row = await this.get(String(rpcId));
    } else if (
      rpcError &&
      /hk_create_task|Could not find the function/i.test(rpcError.message)
    ) {
      row = await enrichHkTask(
        await hkModel.create<HkTask>(hkModel.tables.tasks, body),
      );
      if (body.status === "PENDING" && body.taskType !== "INSPECTION") {
        await syncHkRoomForTask(roomId, { status: "DIRTY" });
      }
      return row;
    } else if (rpcError) {
      throwIfRlsError(rpcError.message);
    } else {
      row = await enrichHkTask(
        await hkModel.create<HkTask>(hkModel.tables.tasks, body),
      );
    }

    return row;
  },

  /** Called from checkout fallback when RPC is unavailable. */
  async onCheckout(options: {
    roomId: string;
    bookingId: string;
    notes?: string;
    createdBy?: string;
  }): Promise<HkTask | null> {
    const roomId =
      (await resolveRoomIdForTask(options.roomId)) ?? options.roomId;
    if (!roomId) return null;

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
    if (!taskId) return null;
    return this.get(taskId);
  },

  async assign(id: string, assignedTo: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    const existing = await getTaskOrThrow(resolved);

    if (!["PENDING", "ASSIGNED"].includes(existing.status)) {
      throw new ConflictError(`Cannot assign task in status ${existing.status}`);
    }

    const now = new Date().toISOString();
    const row = await enrichHkTask(
      await hkModel.update<HkTask>(hkModel.tables.tasks, resolved, {
        status: "ASSIGNED",
        assignedTo: assignedTo.trim() || null,
        assignedAt: now,
      }),
    );

    await syncHkRoomForTask(existing.roomId, {
      status: "DIRTY",
      assignedTo: assignedTo.trim() || null,
    });

    await appendHistory({
      user: assignedTo,
      category: "Cleaning",
      action: "Task assigned",
      room: row.roomNo ?? existing.roomId,
      details: `${row.taskNumber ?? resolved} assigned`,
    });

    return row;
  },

  async start(id: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    const existing = await getTaskOrThrow(resolved);

    if (!["PENDING", "ASSIGNED"].includes(existing.status)) {
      throw new ConflictError(`Cannot start task in status ${existing.status}`);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: "IN_PROGRESS",
      startedAt: now,
    };
    if (!existing.assignedAt && existing.assignedTo) {
      patch.assignedAt = now;
    }

    const row = await enrichHkTask(
      await hkModel.update<HkTask>(hkModel.tables.tasks, resolved, patch),
    );

    await syncHkRoomForTask(existing.roomId, {
      status: "INSPECTING",
      assignedTo: existing.assignedTo ?? null,
    });

    await appendHistory({
      user: String(existing.assignedTo ?? "Housekeeper"),
      category: "Cleaning",
      action: "Task started",
      room: row.roomNo ?? existing.roomId,
      details: `${row.taskNumber ?? resolved} in progress`,
    });

    return row;
  },

  async complete(id: string, notes?: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    const existing = await getTaskOrThrow(resolved);

    if (existing.status !== "IN_PROGRESS") {
      throw new ConflictError(`Cannot complete task in status ${existing.status}`);
    }

    const now = new Date().toISOString();
    const row = await enrichHkTask(
      await hkModel.update<HkTask>(hkModel.tables.tasks, resolved, {
        status: "COMPLETED",
        completedAt: now,
        notes: notes ?? existing.notes,
      }),
    );

    await syncHkRoomForTask(existing.roomId, {
      status: "INSPECTING",
      lastCleanedAt: now,
    });

    await appendHistory({
      user: String(existing.assignedTo ?? "Housekeeper"),
      category: "Cleaning",
      action: "Task completed",
      room: row.roomNo ?? existing.roomId,
      details: `${row.taskNumber ?? resolved} awaiting approval`,
    });

    return row;
  },

  async approve(id: string, approvedBy: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    const existing = await getTaskOrThrow(resolved);

    if (existing.status !== "COMPLETED") {
      throw new ConflictError(`Cannot approve task in status ${existing.status}`);
    }

    const now = new Date().toISOString();
    const row = await enrichHkTask(
      await hkModel.update<HkTask>(hkModel.tables.tasks, resolved, {
        status: "APPROVED",
        approvedAt: now,
        approvedBy: approvedBy.trim() || null,
      }),
    );

    await syncHkRoomForTask(existing.roomId, {
      status: "CLEAN",
      lastInspectedAt: now,
      inspectedBy: approvedBy.trim() || null,
      assignedTo: null,
    });

    await appendHistory({
      user: approvedBy,
      category: "Inspection",
      action: "Task approved",
      room: row.roomNo ?? existing.roomId,
      details: `${row.taskNumber ?? resolved} approved — room clean`,
    });

    return row;
  },

  async cancel(id: string, notes?: string): Promise<HkTask> {
    const resolved = await resolveHkTaskId(id);
    if (!resolved) throw new NotFoundError("Task not found");
    const existing = await getTaskOrThrow(resolved);

    if (existing.status === "APPROVED") {
      throw new ConflictError("Cannot cancel an approved task");
    }

    return enrichHkTask(
      await hkModel.update<HkTask>(hkModel.tables.tasks, resolved, {
        status: "CANCELLED",
        notes: notes ?? existing.notes,
      }),
    );
  },
};

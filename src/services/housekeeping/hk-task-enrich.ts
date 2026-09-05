import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { todayIso } from "../../utils/date.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import {
  resolveGuestRequestAssignee,
  resolveGuestRequestAssigneeLabel,
} from "./guest-request-enrich.js";
import type { HkTask } from "../../types/housekeeping.js";
import { computeHkTaskOverdue } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type ReservationRow = { id: string; bookingNo?: string };
type UserRow = { id: string; name?: string };
type StaffRow = { id: string; name?: string };
type GuestRequestRow = {
  id: string;
  requestNumber?: string;
  description?: string;
};

export const resolveHkTaskAssignee = resolveGuestRequestAssignee;
export const resolveHkTaskAssigneeLabel = resolveGuestRequestAssigneeLabel;

function isHkTaskStaffFkError(message: string): boolean {
  return /housekeeping_tasks_(assigned_to|created_by|approved_by)_fkey/i.test(
    message,
  );
}

function appendStaffNote(
  notes: unknown,
  prefix: string,
  label: string,
): string {
  const line = `${prefix}: ${label}`;
  const base = String(notes ?? "").trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base} · ${line}`;
}

/** Update/create tasks with fallback when users FK is still present. */
export async function persistHkTaskRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  staffLabels?: { assigned?: string; created?: string; approved?: string },
): Promise<HkTask> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<HkTask>(hkModel.tables.tasks, body);
    }
    return hkModel.update<HkTask>(hkModel.tables.tasks, options.id, body);
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isHkTaskStaffFkError(message)) throw error;

    const fallback: Record<string, unknown> = { ...payload };
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

async function fetchStaffByIds(ids: string[]): Promise<Map<string, StaffRow>> {
  const map = new Map<string, StaffRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(hkModel.tables.staff)
    .select("id, name")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const staff = toCamel<StaffRow>(row);
    map.set(staff.id, staff);
  }
  return map;
}

function staffOrUserName(
  key: string | null | undefined,
  staff: Map<string, StaffRow>,
  users: Map<string, UserRow>,
): string | undefined {
  if (!key) return undefined;
  return (
    staff.get(String(key))?.name ??
    users.get(String(key))?.name ??
    String(key)
  );
}

export function sanitizeHkTaskInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

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

export type HkTaskScheduleInput = {
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  dueAt?: string | null;
};

function combineDateAndTime(
  date?: string | null,
  time?: string | null,
): string | null {
  const d = String(date ?? "").trim();
  const t = String(time ?? "").trim();
  if (!d || !t) return null;
  const normalized = t.length === 5 ? `${t}:00` : t;
  return `${d}T${normalized}`;
}

export function parseHkTaskScheduleInput(
  input: Record<string, unknown>,
): HkTaskScheduleInput {
  const scheduledDate =
    (typeof input.scheduledDate === "string" ? input.scheduledDate : null) ??
    (typeof input.cleaningDate === "string" ? input.cleaningDate : null);

  let scheduledStartAt =
    typeof input.scheduledStartAt === "string" ? input.scheduledStartAt : null;
  let dueAt = typeof input.dueAt === "string" ? input.dueAt : null;

  const startTime =
    typeof input.startTime === "string"
      ? input.startTime
      : typeof input.scheduleStartTime === "string"
        ? input.scheduleStartTime
        : null;
  const dueTime =
    typeof input.dueTime === "string"
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

export function buildHkTaskSchedulePayload(
  input: HkTaskScheduleInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.scheduledDate) payload.scheduledDate = input.scheduledDate;
  if (input.scheduledStartAt) payload.scheduledStartAt = input.scheduledStartAt;
  if (input.dueAt) payload.dueAt = input.dueAt;
  return payload;
}

function normalizeIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function validateHkTaskScheduleNotInPast(
  schedule: HkTaskScheduleInput,
  minDate: string = todayIso(),
): string | null {
  const min = normalizeIsoDate(minDate);
  if (!min) return null;

  const dates = [
    schedule.scheduledDate,
    schedule.scheduledStartAt?.slice(0, 10),
    schedule.dueAt?.slice(0, 10),
  ].filter((value): value is string => Boolean(value));

  for (const date of dates) {
    const normalized = normalizeIsoDate(date);
    if (normalized && normalized < min) {
      return "Scheduled date cannot be in the past";
    }
  }

  return null;
}

async function fetchRoomsByIds(ids: string[]): Promise<Map<string, FoRoom>> {
  const map = new Map<string, FoRoom>();
  if (!ids.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.rooms)
    .select("id, room_no")
    .in("id", ids);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const room = toCamel<FoRoom>(row);
    map.set(room.id, room);
  }
  return map;
}

async function fetchBookingsByIds(ids: string[]): Promise<Map<string, ReservationRow>> {
  const map = new Map<string, ReservationRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.reservations)
    .select("id, booking_no")
    .in("id", unique);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const booking = toCamel<ReservationRow>(row);
    map.set(booking.id, booking);
  }
  return map;
}

async function fetchUsersByIds(ids: string[]): Promise<Map<string, UserRow>> {
  const map = new Map<string, UserRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const user = toCamel<UserRow>(row);
    map.set(user.id, user);
  }
  return map;
}

async function fetchGuestRequestsByIds(
  ids: string[],
): Promise<Map<string, GuestRequestRow>> {
  const map = new Map<string, GuestRequestRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(hkModel.tables.guestRequests)
    .select("id, request_number, description")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const request = toCamel<GuestRequestRow>(row);
    map.set(request.id, request);
  }
  return map;
}

function applyEnrichment(
  row: HkTask,
  room?: FoRoom,
  booking?: ReservationRow,
  staff: Map<string, StaffRow> = new Map(),
  users: Map<string, UserRow> = new Map(),
  guestRequest?: GuestRequestRow,
): HkTask {
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

export async function enrichHkTask(row: HkTask): Promise<HkTask> {
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

  return applyEnrichment(
    row,
    roomMap.get(roomId),
    bookingId ? bookingMap.get(bookingId) : undefined,
    staffMap,
    userMap,
    requestId ? requestMap.get(requestId) : undefined,
  );
}

export async function enrichHkTasks(rows: HkTask[]): Promise<HkTask[]> {
  if (!rows.length) return [];

  const roomIds = [...new Set(rows.map((r) => String(r.roomId)).filter(Boolean))];
  const bookingIds = [
    ...new Set(
      rows.map((r) => String(r.bookingId ?? "")).filter(Boolean),
    ),
  ];
  const requestIds = [
    ...new Set(
      rows.map((r) => String(r.requestId ?? "")).filter(Boolean),
    ),
  ];
  const staffIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignedTo, r.createdBy, r.approvedBy])
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [roomMap, bookingMap, staffMap, userMap, requestMap] = await Promise.all([
    fetchRoomsByIds(roomIds),
    fetchBookingsByIds(bookingIds),
    fetchStaffByIds(staffIds),
    fetchUsersByIds(staffIds),
    fetchGuestRequestsByIds(requestIds),
  ]);

  return rows.map((row) =>
    applyEnrichment(
      row,
      roomMap.get(String(row.roomId)),
      row.bookingId ? bookingMap.get(String(row.bookingId)) : undefined,
      staffMap,
      userMap,
      row.requestId ? requestMap.get(String(row.requestId)) : undefined,
    ),
  );
}

export async function resolveHkTaskId(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<HkTask>(hkModel.tables.tasks, trimmed);
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(hkModel.tables.tasks)
    .select("id")
    .eq("task_number", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveRoomIdForTask(key: string): Promise<string | null> {
  return resolveRoomId(key);
}

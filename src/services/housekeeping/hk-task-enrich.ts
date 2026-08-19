import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import type { HkTask } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type ReservationRow = { id: string; bookingNo?: string };
type UserRow = { id: string; name?: string };

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
  delete body.updatedAt;
  delete body.createdAt;

  return body;
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

function applyEnrichment(
  row: HkTask,
  room?: FoRoom,
  booking?: ReservationRow,
  users: Map<string, UserRow> = new Map(),
): HkTask {
  return {
    ...row,
    roomNo: room?.roomNo ?? row.roomNo,
    bookingNo: booking?.bookingNo ?? row.bookingNo,
    assignedToName: row.assignedTo
      ? users.get(String(row.assignedTo))?.name
      : undefined,
    createdByName: row.createdBy
      ? users.get(String(row.createdBy))?.name
      : undefined,
    approvedByName: row.approvedBy
      ? users.get(String(row.approvedBy))?.name
      : undefined,
  };
}

export async function enrichHkTask(row: HkTask): Promise<HkTask> {
  const roomId = String(row.roomId ?? "");
  const bookingId = row.bookingId ? String(row.bookingId) : "";
  const userIds = [row.assignedTo, row.createdBy, row.approvedBy]
    .filter(Boolean)
    .map(String);

  const [roomMap, bookingMap, userMap] = await Promise.all([
    roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
    bookingId ? fetchBookingsByIds([bookingId]) : Promise.resolve(new Map()),
    fetchUsersByIds(userIds),
  ]);

  return applyEnrichment(
    row,
    roomMap.get(roomId),
    bookingId ? bookingMap.get(bookingId) : undefined,
    userMap,
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
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignedTo, r.createdBy, r.approvedBy])
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [roomMap, bookingMap, userMap] = await Promise.all([
    fetchRoomsByIds(roomIds),
    fetchBookingsByIds(bookingIds),
    fetchUsersByIds(userIds),
  ]);

  return rows.map((row) =>
    applyEnrichment(
      row,
      roomMap.get(String(row.roomId)),
      row.bookingId ? bookingMap.get(String(row.bookingId)) : undefined,
      userMap,
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

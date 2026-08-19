import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import type { GuestRequest } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type ReservationRow = {
  id: string;
  bookingNo?: string;
  guestId?: string;
  guestName?: string;
};
type UserRow = { id: string; name?: string };
type StaffRow = { id: string; name?: string };

/** Resolve hk_staff id from UI staff name or id. */
export async function resolveGuestRequestAssignee(
  input: unknown,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "—") return null;

  const staffTable = hkModel.tables.staff;

  const { data: byId } = await supabase
    .from(staffTable)
    .select("id")
    .eq("id", raw)
    .maybeSingle();
  if (byId?.id) return String(byId.id);

  const { data: staffRows } = await supabase
    .from(staffTable)
    .select("id, name");

  const exact = (staffRows ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === raw.toLowerCase(),
  );
  if (exact?.id) return String(exact.id);

  return raw;
}

/** Human-readable staff label for notes / API enrichment. */
export async function resolveGuestRequestAssigneeLabel(
  input: unknown,
): Promise<string> {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "—") return "";

  const staffTable = hkModel.tables.staff;

  const { data: byId } = await supabase
    .from(staffTable)
    .select("name")
    .eq("id", raw)
    .maybeSingle();
  if (byId?.name) return String(byId.name);

  const { data: staffRows } = await supabase
    .from(staffTable)
    .select("id, name");

  const exact = (staffRows ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === raw.toLowerCase(),
  );
  if (exact?.name) return String(exact.name);
  if (exact?.id === raw) return raw;

  return raw;
}

function isAssigneeFkError(message: string): boolean {
  return /guest_requests_(assigned_to|created_by)_fkey/i.test(message);
}

function appendAssigneeNote(
  notes: unknown,
  assigneeLabel: string,
): string | null | undefined {
  if (!assigneeLabel) return notes as string | null | undefined;
  const prefix = `Assigned to: ${assigneeLabel}`;
  const base = String(notes ?? "").trim();
  if (!base) return prefix;
  if (base.includes(prefix)) return base;
  return `${base} · ${prefix}`;
}

/** Insert/update with fallback when legacy users FK is still on assigned_to. */
export async function persistGuestRequestRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  assigneeLabel: string,
): Promise<GuestRequest> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<GuestRequest>(hkModel.tables.guestRequests, body);
    }
    return hkModel.update<GuestRequest>(
      hkModel.tables.guestRequests,
      options.id,
      body,
    );
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAssigneeFkError(message)) throw error;

    const fallback: Record<string, unknown> = {
      ...payload,
      assignedTo: null,
      createdBy: null,
      notes: appendAssigneeNote(payload.notes, assigneeLabel),
    };
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

export function sanitizeGuestRequestInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  if (body.roomRefId != null && body.roomId == null) {
    body.roomId = body.roomRefId;
  }
  if (body.roomNo != null && body.roomId == null) {
    body.roomId = body.roomNo;
  }
  if (body.room != null && body.roomId == null) {
    body.roomId = body.room;
  }
  if (body.reservationId != null && body.bookingId == null) {
    body.bookingId = body.reservationId;
  }
  if (body.issue != null && body.description == null) {
    body.description = body.issue;
  }
  if (body.assignedStaff != null && body.assignedTo == null) {
    body.assignedTo = body.assignedStaff;
  }
  if (body.remarks != null && body.notes == null) {
    body.notes = body.remarks;
  }
  if (body.guest != null && body.guestName == null) {
    body.guestName = body.guest;
  }

  delete body.roomRefId;
  delete body.roomNo;
  delete body.room;
  delete body.reservationId;
  delete body.assignedStaff;
  delete body.remarks;
  delete body.issue;
  delete body.guest;
  delete body.guestName;
  delete body.requestNumber;
  delete body.updatedAt;
  delete body.createdAt;
  delete body.assignmentType;
  delete body.assignmentHistory;
  delete body.createdAtLabel;

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

async function fetchBookingsByIds(
  ids: string[],
): Promise<Map<string, ReservationRow>> {
  const map = new Map<string, ReservationRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.reservations)
    .select("id, booking_no, guest_id")
    .in("id", unique);

  if (error) throw new Error(error.message);

  const guestIds = [
    ...new Set(
      (data ?? [])
        .map((row) => String(row.guest_id ?? "").trim())
        .filter(Boolean),
    ),
  ];

  const guestNames = new Map<string, string>();
  if (guestIds.length) {
    const { data: guests, error: guestError } = await supabase
      .from(foModel.tables.guests)
      .select("id, name")
      .in("id", guestIds);

    if (guestError) throw new Error(guestError.message);
    for (const guest of guests ?? []) {
      guestNames.set(String(guest.id), String(guest.name ?? ""));
    }
  }

  for (const row of data ?? []) {
    const guestId = row.guest_id ? String(row.guest_id) : undefined;
    const booking = toCamel<ReservationRow>({
      id: row.id,
      booking_no: row.booking_no,
      guest_id: guestId,
      guest_name: guestId ? guestNames.get(guestId) : undefined,
    });
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
  row: GuestRequest,
  room?: FoRoom,
  booking?: ReservationRow,
  users: Map<string, UserRow> = new Map(),
  staff: Map<string, StaffRow> = new Map(),
): GuestRequest {
  const assignedKey = row.assignedTo ? String(row.assignedTo) : "";
  const assignedToName =
    staff.get(assignedKey)?.name ??
    users.get(assignedKey)?.name ??
    (assignedKey || undefined);

  const createdKey = row.createdBy ? String(row.createdBy) : "";
  const createdByName =
    staff.get(createdKey)?.name ??
    users.get(createdKey)?.name ??
    (createdKey || undefined);

  return {
    ...row,
    roomNo: room?.roomNo ?? row.roomNo,
    bookingNo: booking?.bookingNo ?? row.bookingNo,
    guestName: booking?.guestName ?? row.guestName,
    assignedToName,
    createdByName,
  };
}

export async function enrichGuestRequest(row: GuestRequest): Promise<GuestRequest> {
  const roomId = String(row.roomId ?? "");
  const bookingId = row.bookingId ? String(row.bookingId) : "";
  const assigneeIds = [row.assignedTo, row.createdBy].filter(Boolean).map(String);

  const [roomMap, bookingMap, userMap, staffMap] = await Promise.all([
    roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
    bookingId ? fetchBookingsByIds([bookingId]) : Promise.resolve(new Map()),
    fetchUsersByIds(assigneeIds),
    fetchStaffByIds(assigneeIds),
  ]);

  return applyEnrichment(
    row,
    roomMap.get(roomId),
    bookingId ? bookingMap.get(bookingId) : undefined,
    userMap,
    staffMap,
  );
}

export async function enrichGuestRequests(
  rows: GuestRequest[],
): Promise<GuestRequest[]> {
  if (!rows.length) return [];

  const roomIds = [...new Set(rows.map((r) => String(r.roomId)).filter(Boolean))];
  const bookingIds = [
    ...new Set(rows.map((r) => String(r.bookingId ?? "")).filter(Boolean)),
  ];
  const assigneeIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignedTo, r.createdBy])
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [roomMap, bookingMap, userMap, staffMap] = await Promise.all([
    fetchRoomsByIds(roomIds),
    fetchBookingsByIds(bookingIds),
    fetchUsersByIds(assigneeIds),
    fetchStaffByIds(assigneeIds),
  ]);

  return rows.map((row) =>
    applyEnrichment(
      row,
      roomMap.get(String(row.roomId)),
      row.bookingId ? bookingMap.get(String(row.bookingId)) : undefined,
      userMap,
      staffMap,
    ),
  );
}

export async function resolveGuestRequestId(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<GuestRequest>(
    hkModel.tables.guestRequests,
    trimmed,
  );
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(hkModel.tables.guestRequests)
    .select("id")
    .eq("request_number", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveRoomIdForGuestRequest(
  key: string,
): Promise<string | null> {
  return resolveRoomId(key);
}

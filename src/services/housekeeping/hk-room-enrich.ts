import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Reservation } from "../../types/front-office.js";
import { enrichReservations } from "../front-office/reservation-enrich.js";
import { buildActiveBookingByRoomNo } from "../front-office/room-hk-status.js";
import type { HkRoom } from "../../types/housekeeping.js";

type FoRoom = {
  id: string;
  roomNo?: string;
  roomType?: string;
  floor?: string;
  bedType?: string;
  maxOccupancy?: number;
  isActive?: boolean;
};

type UserRow = { id: string; name?: string };
type StaffRow = { id: string; name?: string };

type BookingOverlay = {
  guestName?: string;
  checkoutDate?: string;
  isOccupied: boolean;
};

function isInHouseReservation(status: unknown): boolean {
  const value = String(status ?? "");
  return value === "Checked In" || value === "In-House";
}

async function fetchActiveBookingsByRoomNo(): Promise<Map<string, BookingOverlay>> {
  try {
    const reservations = await enrichReservations(
      await foModel.list<Reservation>(foModel.tables.reservations),
    );
    const bookingByRoom = buildActiveBookingByRoomNo(reservations);
    const map = new Map<string, BookingOverlay>();

    for (const [roomNo, booking] of bookingByRoom) {
      map.set(roomNo, {
        guestName: String(booking.guestName ?? "").trim() || undefined,
        checkoutDate: String(booking.checkOut ?? "").trim() || undefined,
        isOccupied: isInHouseReservation(booking.status),
      });
    }

    return map;
  } catch {
    return new Map();
  }
}

function isHkRoomStaffFkError(message: string): boolean {
  return /hk_rooms_(assigned_to|inspected_by)_fkey/i.test(message);
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

/** Update/create hk_rooms with fallback when users FK is still present. */
export async function persistHkRoomRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  staffLabels?: { assigned?: string; inspected?: string },
): Promise<HkRoom> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<HkRoom>(hkModel.tables.rooms, body);
    }
    return hkModel.update<HkRoom>(hkModel.tables.rooms, options.id, body);
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isHkRoomStaffFkError(message)) throw error;

    const fallback: Record<string, unknown> = { ...payload };
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

export function sanitizeHkRoomInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

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

async function fetchFoRoomsByIds(ids: string[]): Promise<Map<string, FoRoom>> {
  const map = new Map<string, FoRoom>();
  if (!ids.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.rooms)
    .select("id, room_no, room_type, floor, bed_type, max_occupancy, is_active")
    .in("id", ids);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const room = toCamel<FoRoom>(row);
    map.set(room.id, room);
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

async function resolveRoomId(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await foModel.get<FoRoom>(foModel.tables.rooms, trimmed);
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(foModel.tables.rooms)
    .select("id")
    .eq("room_no", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveHkRoomId(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<HkRoom>(hkModel.tables.rooms, trimmed);
  if (byId?.id) return byId.id;

  const roomId = await resolveRoomId(trimmed);
  if (!roomId) return null;

  const { data, error } = await supabase
    .from(hkModel.tables.rooms)
    .select("id")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

function applyEnrichment(
  row: HkRoom,
  room?: FoRoom,
  staff: Map<string, StaffRow> = new Map(),
  users: Map<string, UserRow> = new Map(),
  booking?: BookingOverlay,
): HkRoom {
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
    guestName: booking?.guestName,
    checkoutDate: booking?.checkoutDate,
    isOccupied: booking?.isOccupied ?? false,
  };
}

export async function enrichHkRoom(row: HkRoom): Promise<HkRoom> {
  const roomId = String(row.roomId ?? "");
  const staffIds = [row.assignedTo, row.inspectedBy].filter(Boolean).map(String);
  const [roomMap, staffMap, userMap, bookingByRoom] = await Promise.all([
    roomId ? fetchFoRoomsByIds([roomId]) : Promise.resolve(new Map()),
    fetchStaffByIds(staffIds),
    fetchUsersByIds(staffIds),
    fetchActiveBookingsByRoomNo(),
  ]);
  const foRoom = roomMap.get(roomId);
  const booking = foRoom?.roomNo ? bookingByRoom.get(String(foRoom.roomNo)) : undefined;
  return applyEnrichment(row, foRoom, staffMap, userMap, booking);
}

export async function enrichHkRooms(rows: HkRoom[]): Promise<HkRoom[]> {
  if (!rows.length) return [];

  const roomIds = [...new Set(rows.map((r) => String(r.roomId)).filter(Boolean))];
  const staffIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignedTo, r.inspectedBy])
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [roomMap, staffMap, userMap, bookingByRoom] = await Promise.all([
    fetchFoRoomsByIds(roomIds),
    fetchStaffByIds(staffIds),
    fetchUsersByIds(staffIds),
    fetchActiveBookingsByRoomNo(),
  ]);

  return rows.map((row) => {
    const foRoom = roomMap.get(String(row.roomId));
    const booking = foRoom?.roomNo ? bookingByRoom.get(String(foRoom.roomNo)) : undefined;
    return applyEnrichment(row, foRoom, staffMap, userMap, booking);
  });
}

export { resolveRoomId };

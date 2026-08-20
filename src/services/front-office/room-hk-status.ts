import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import {
  normalizeHkRoomStatus,
  type HkRoomStatus,
} from "../../types/housekeeping.js";

type BookingOverlay = {
  guestName?: string;
  checkOut?: string;
  status?: string;
};

export async function fetchHkStatusByRoomIds(
  roomIds: string[],
): Promise<Map<string, HkRoomStatus>> {
  const map = new Map<string, HkRoomStatus>();
  const unique = [...new Set(roomIds.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(hkModel.tables.rooms)
    .select("room_id, status")
    .in("room_id", unique);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    map.set(String(row.room_id), normalizeHkRoomStatus(row.status));
  }
  return map;
}

export function foStatusQueryToHkStatuses(status: string): HkRoomStatus[] | null {
  const value = status.trim().toLowerCase();
  if (!value) return null;
  switch (value) {
    case "vacant":
    case "clean":
      return ["CLEAN", "INSPECTED"];
    case "dirty":
      return ["DIRTY"];
    case "maintenance":
      return ["INSPECTING"];
    case "blocked":
      return ["OUT_OF_SERVICE"];
    default:
      return null;
  }
}

export function hkStatusToHousekeeping(hkStatus: HkRoomStatus): string {
  switch (hkStatus) {
    case "DIRTY":
      return "Dirty";
    case "INSPECTING":
    case "OUT_OF_SERVICE":
      return "In Progress";
    default:
      return "Clean";
  }
}

export function hkStatusToMaintenance(hkStatus: HkRoomStatus): string {
  return hkStatus === "OUT_OF_SERVICE" || hkStatus === "INSPECTING"
    ? "In Progress"
    : "OK";
}

/** Base FO room status from hk_rooms (before reservation overlay). */
export function hkStatusToBaseFoStatus(hkStatus: HkRoomStatus): string {
  switch (hkStatus) {
    case "OUT_OF_SERVICE":
      return "Blocked";
    case "INSPECTING":
      return "Maintenance";
    case "DIRTY":
      return "Dirty";
    case "CLEAN":
    case "INSPECTED":
    default:
      return "Vacant";
  }
}

export function deriveFoRoomStatus(
  hkStatus: HkRoomStatus,
  booking?: BookingOverlay | null,
  isActive = true,
): string {
  if (!isActive) return "Blocked";

  if (booking) {
    const bookingStatus = String(booking.status ?? "");
    if (bookingStatus === "Checked In" || bookingStatus === "In-House") {
      return "Occupied";
    }
    const base = hkStatusToBaseFoStatus(hkStatus);
    if (base === "Vacant" || base === "Clean") {
      return "Reserved";
    }
    return base;
  }

  return hkStatusToBaseFoStatus(hkStatus);
}

export function isHkRoomSellable(hkStatus: HkRoomStatus, isActive = true): boolean {
  if (!isActive) return false;
  return hkStatus !== "OUT_OF_SERVICE" && hkStatus !== "INSPECTING";
}

export async function ensureHkRoomForFoRoom(roomId: string): Promise<void> {
  const { data, error } = await supabase
    .from(hkModel.tables.rooms)
    .select("id")
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.id) return;

  await hkModel.create(hkModel.tables.rooms, {
    id: foModel.newId(),
    roomId,
    status: "DIRTY",
  });
}

type ReservationLike = {
  roomNo?: unknown;
  status?: unknown;
  guestName?: unknown;
  checkOut?: unknown;
};

export function buildActiveBookingByRoomNo<T extends ReservationLike>(
  reservations: T[],
): Map<string, T> {
  const bookingByRoom = new Map<string, T>();

  for (const reservation of reservations) {
    const roomNo = String(reservation.roomNo ?? "").trim();
    if (!roomNo || /^(tba|n\/?a|unassigned|-)$/i.test(roomNo)) continue;

    const status = String(reservation.status ?? "");
    if (
      status === "Cancelled" ||
      status === "Checked Out" ||
      status === "No Show"
    ) {
      continue;
    }

    const previous = bookingByRoom.get(roomNo);
    if (
      !previous ||
      status === "Checked In" ||
      status === "In-House"
    ) {
      bookingByRoom.set(roomNo, reservation);
    }
  }

  return bookingByRoom;
}

export function availabilityDayStatus(
  hkStatus: HkRoomStatus,
  isActive: boolean,
  hasBooking: boolean,
  bookingInHouse: boolean,
): "available" | "reserved" | "occupied" | "dirty" | "maintenance" | "blocked" {
  if (!isActive) return "blocked";
  if (hkStatus === "OUT_OF_SERVICE") return "blocked";
  if (hkStatus === "INSPECTING") return "maintenance";
  if (hasBooking) return bookingInHouse ? "occupied" : "reserved";
  if (hkStatus === "DIRTY") return "dirty";
  return "available";
}

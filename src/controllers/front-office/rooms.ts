import type { Request, Response } from "express";
import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import {
  availabilityDayStatus,
  buildActiveBookingByRoomNo,
  deriveFoRoomStatus,
  ensureHkRoomForFoRoom,
  fetchHkStatusByRoomIds,
  foStatusQueryToHkStatuses,
  hkStatusToHousekeeping,
  hkStatusToMaintenance,
} from "../../services/front-office/room-hk-status.js";
import { sanitizeRoomInput } from "../../services/front-office/room-sanitize.js";
import { fromError, ok } from "../../utils/response.js";
import type { Reservation } from "../../types/front-office.js";
import type { HkRoomStatus } from "../../types/housekeeping.js";

type Room = Record<string, unknown>;

async function findRoomByParam(param: string): Promise<Room | null> {
  const byId = await foModel.get<Room>(foModel.tables.rooms, param);
  if (byId) return byId;

  const { data, error } = await supabase
    .from(foModel.tables.rooms)
    .select("*")
    .eq("room_no", param)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<Room>(data) : null;
}

export async function listRooms(req: Request, res: Response) {
  try {
    const status = req.query.status as string | undefined;
    let rows = await foModel.list<Room>(foModel.tables.rooms, {
      orderBy: "room_no",
    });

    const hkStatuses = status ? foStatusQueryToHkStatuses(status) : null;
    if (hkStatuses) {
      const hkMap = await fetchHkStatusByRoomIds(rows.map((r) => String(r.id)));
      rows = rows.filter((room) => {
        const hkStatus = hkMap.get(String(room.id)) ?? "DIRTY";
        return hkStatuses.includes(hkStatus);
      });
    }

    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getRoom(req: Request, res: Response) {
  try {
    const row = await findRoomByParam(String(req.params.id));
    if (!row) return fromError(res, new Error("Room not found"), 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateRoom(req: Request, res: Response) {
  try {
    const existing = await findRoomByParam(String(req.params.id));
    if (!existing) return fromError(res, new Error("Room not found"), 404);
    const body = sanitizeRoomInput(req.body as Record<string, unknown>);
    const row = await foModel.update(
      foModel.tables.rooms,
      String(existing.id),
      body,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createRoom(req: Request, res: Response) {
  try {
    const body = sanitizeRoomInput(req.body as Record<string, unknown>);
    if (!body.id) body.id = foModel.newId();
    if (body.maxOccupancy === undefined) body.maxOccupancy = 2;
    if (!body.bedType) body.bedType = "Queen";
    if (body.isActive === undefined) body.isActive = true;
    const row = (await foModel.create(foModel.tables.rooms, body)) as Room;
    await ensureHkRoomForFoRoom(String(row.id));
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function compareFloor(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function roomAvailability(req: Request, res: Response) {
  try {
    const startParam = (req.query.start as string) || undefined;
    const anchor = parseIsoDate(startParam) ?? startOfDay(new Date());
    const monthStart = startOfMonth(anchor);
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const dayCount = daysInMonth(year, month);

    const days: string[] = [];
    for (let i = 0; i < dayCount; i++) {
      days.push(toIsoDate(addDays(monthStart, i)));
    }

    const [rooms, reservations] = await Promise.all([
      foModel.list<Room>(foModel.tables.rooms, { orderBy: "room_no" }),
      enrichReservations(
        await foModel.list<Reservation>(foModel.tables.reservations),
      ),
    ]);

    const hkByRoomId = await fetchHkStatusByRoomIds(
      rooms.map((room) => String(room.id)),
    );

    const activeReservations = reservations
      .filter(
        (r) =>
          r.status !== "Cancelled" &&
          r.status !== "Checked Out" &&
          r.status !== "No Show" &&
          r.roomNo,
      )
      .map((r) => ({
        roomNo: String(r.roomNo),
        checkIn: parseStayDate(String(r.checkIn ?? "")),
        checkOut: parseStayDate(String(r.checkOut ?? "")),
        status: String(r.status ?? ""),
      }))
      .filter((r) => r.checkIn && r.checkOut) as {
      roomNo: string;
      checkIn: Date;
      checkOut: Date;
      status: string;
    }[];

    const inHouseStatuses = new Set(["Checked In", "In-House"]);

    const sortedRooms = [...rooms].sort((a, b) => {
      const floorCompare = compareFloor(String(a.floor ?? ""), String(b.floor ?? ""));
      if (floorCompare !== 0) return floorCompare;
      return String(a.roomNo ?? "").localeCompare(String(b.roomNo ?? ""), undefined, {
        numeric: true,
      });
    });

    const rows = sortedRooms.map((room) => {
      const dayMap: Record<
        string,
        "available" | "reserved" | "occupied" | "dirty" | "maintenance" | "blocked"
      > = {};
      const roomId = String(room.id);
      const hkStatus: HkRoomStatus = hkByRoomId.get(roomId) ?? "DIRTY";
      const isActive = room.isActive !== false;

      for (const dayIso of days) {
        const day = parseIsoDate(dayIso)!;
        const booking = activeReservations.find(
          (r) =>
            r.roomNo === String(room.roomNo) &&
            startOfDay(day).getTime() >= startOfDay(r.checkIn).getTime() &&
            startOfDay(day).getTime() < startOfDay(r.checkOut).getTime(),
        );

        dayMap[dayIso] = availabilityDayStatus(
          hkStatus,
          isActive,
          Boolean(booking),
          booking ? inHouseStatuses.has(booking.status) : false,
        );
      }

      return {
        room: String(room.roomNo ?? ""),
        type: String(room.roomType ?? ""),
        floor: String(room.floor ?? "").trim() || "Unassigned",
        bedType: String(room.bedType ?? "").trim() || undefined,
        days: dayMap,
      };
    });

    return ok(res, {
      start: toIsoDate(monthStart),
      month: `${year}-${String(month + 1).padStart(2, "0")}`,
      days,
      rows,
    });
  } catch (e) {
    return fromError(res, e);
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseStayDate(value: string): Date | null {
  if (!value) return null;
  const iso = parseIsoDate(value.slice(0, 10));
  if (iso) return iso;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

export async function roomStatusCards(_req: Request, res: Response) {
  try {
    const [rooms, reservations] = await Promise.all([
      foModel.list<Room>(foModel.tables.rooms, { orderBy: "room_no" }),
      enrichReservations(
        await foModel.list<Reservation>(foModel.tables.reservations),
      ),
    ]);

    const hkByRoomId = await fetchHkStatusByRoomIds(
      rooms.map((room) => String(room.id)),
    );
    const bookingByRoom = buildActiveBookingByRoomNo(reservations);

    const cards = rooms.map((room) => {
      const roomNo = String(room.roomNo);
      const roomId = String(room.id);
      const hkStatus: HkRoomStatus = hkByRoomId.get(roomId) ?? "DIRTY";
      const isActive = room.isActive !== false;
      const booking = bookingByRoom.get(roomNo);
      const status = deriveFoRoomStatus(hkStatus, booking, isActive);

      return {
        id: room.id,
        roomNo,
        type: room.roomType,
        floor: room.floor,
        status,
        guestName: booking
          ? String(booking.guestName ?? "").trim() || undefined
          : undefined,
        housekeeping: hkStatusToHousekeeping(hkStatus),
        maintenance: hkStatusToMaintenance(hkStatus),
        checkoutDate: booking
          ? String(booking.checkOut ?? "").trim() || undefined
          : undefined,
      };
    });
    return ok(res, cards);
  } catch (e) {
    return fromError(res, e);
  }
}

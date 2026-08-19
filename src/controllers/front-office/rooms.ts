import type { Request, Response } from "express";
import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import { sanitizeRoomInput } from "../../services/front-office/room-sanitize.js";
import { fromError, ok } from "../../utils/response.js";
import type { Reservation } from "../../types/front-office.js";

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
    const rows = await foModel.list(foModel.tables.rooms, {
      filters: status ? { status } : undefined,
      orderBy: "room_no",
    });
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
    if (!body.status) body.status = "Vacant";
    const row = await foModel.create(foModel.tables.rooms, body);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function roomAvailability(req: Request, res: Response) {
  try {
    const startParam = (req.query.start as string) || undefined;
    const start = parseIsoDate(startParam) ?? startOfDay(new Date());

    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(toIsoDate(addDays(start, i)));
    }

    const [rooms, reservations] = await Promise.all([
      foModel.list<Room>(foModel.tables.rooms, { orderBy: "room_no" }),
      enrichReservations(
        await foModel.list<Reservation>(foModel.tables.reservations),
      ),
    ]);

    const activeReservations = reservations
      .filter(
        (r) =>
          r.status !== "Cancelled" &&
          r.status !== "Checked Out" &&
          r.roomNo,
      )
      .map((r) => ({
        roomNo: String(r.roomNo),
        checkIn: parseStayDate(String(r.checkIn ?? "")),
        checkOut: parseStayDate(String(r.checkOut ?? "")),
      }))
      .filter((r) => r.checkIn && r.checkOut) as {
      roomNo: string;
      checkIn: Date;
      checkOut: Date;
    }[];

    const rows = rooms.map((room) => {
      const dayMap: Record<string, "booked" | "available" | "blocked"> = {};
      for (const dayIso of days) {
        const day = parseIsoDate(dayIso)!;
        if (room.status === "Blocked" || room.status === "Maintenance") {
          dayMap[dayIso] = "blocked";
          continue;
        }
        const booked = activeReservations.some(
          (r) =>
            r.roomNo === room.roomNo &&
            startOfDay(day).getTime() >= startOfDay(r.checkIn).getTime() &&
            startOfDay(day).getTime() < startOfDay(r.checkOut).getTime(),
        );
        dayMap[dayIso] = booked ? "booked" : "available";
      }
      return {
        room: room.roomNo,
        type: room.roomType,
        floor: room.floor,
        days: dayMap,
      };
    });

    return ok(res, { start: toIsoDate(start), days, rows });
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

    const bookingByRoom = new Map<string, Reservation>();
    for (const r of reservations) {
      const roomNo = String(r.roomNo ?? "").trim();
      if (!roomNo || /^(tba|n\/?a|unassigned|-)$/i.test(roomNo)) continue;
      const status = String(r.status ?? "");
      if (
        status === "Cancelled" ||
        status === "Checked Out" ||
        status === "No Show"
      ) {
        continue;
      }
      const prev = bookingByRoom.get(roomNo);
      if (
        !prev ||
        status === "Checked In" ||
        status === "In-House"
      ) {
        bookingByRoom.set(roomNo, r);
      }
    }

    const cards = rooms.map((r) => {
      const roomNo = String(r.roomNo);
      const booking = bookingByRoom.get(roomNo);
      let status = String(r.status ?? "Vacant");
      let guestName: string | undefined;
      let checkoutDate: string | undefined;

      if (booking) {
        guestName = String(booking.guestName ?? "").trim() || undefined;
        checkoutDate = String(booking.checkOut ?? "").trim() || undefined;
        const bStatus = String(booking.status);
        if (bStatus === "Checked In" || bStatus === "In-House") {
          status = "Occupied";
        } else if (status === "Vacant" || status === "Clean" || status === "Reserved") {
          status = "Reserved";
        }
      }

      const housekeeping =
        status === "Dirty"
          ? "Dirty"
          : status === "Maintenance"
            ? "In Progress"
            : "Clean";
      const maintenance = status === "Maintenance" ? "In Progress" : "OK";

      return {
        id: r.id,
        roomNo,
        type: r.roomType,
        floor: r.floor,
        status,
        guestName,
        housekeeping,
        maintenance,
        checkoutDate,
      };
    });
    return ok(res, cards);
  } catch (e) {
    return fromError(res, e);
  }
}

import type { Request, Response } from "express";
import { foModel } from "../../models/front-office/index.js";
import { fromError, ok } from "../../utils/response.js";

type Room = Record<string, unknown>;
type Reservation = Record<string, unknown>;

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
    const row = await foModel.get(
      foModel.tables.rooms,
      String(req.params.id),
      "room_no",
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateRoom(req: Request, res: Response) {
  try {
    const row = await foModel.update(
      foModel.tables.rooms,
      String(req.params.id),
      req.body as Record<string, unknown>,
      "room_no",
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createRoom(req: Request, res: Response) {
  try {
    const row = await foModel.create(
      foModel.tables.rooms,
      req.body as Record<string, unknown>,
    );
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
      foModel.list<Reservation>(foModel.tables.reservations),
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
      foModel.list<Reservation>(foModel.tables.reservations),
    ]);

    // Overlay active bookings so Room Status stays correct even if rooms.status lagged
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
      // Prefer in-house over reserved if both somehow exist
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
      let guestName = r.guestName ? String(r.guestName) : undefined;
      let checkoutDate = r.checkoutDate ? String(r.checkoutDate) : undefined;

      if (booking) {
        guestName = String(booking.guestName ?? guestName ?? "");
        checkoutDate = String(booking.checkOut ?? checkoutDate ?? "");
        const bStatus = String(booking.status);
        if (bStatus === "Checked In" || bStatus === "In-House") {
          status = "Occupied";
        } else if (status === "Vacant" || status === "Clean" || status === "Reserved") {
          status = "Reserved";
        }
      }

      return {
        roomNo,
        type: r.roomType,
        floor: r.floor,
        status,
        guestName,
        housekeeping: r.housekeeping,
        maintenance: r.maintenance,
        checkoutDate,
      };
    });
    return ok(res, cards);
  } catch (e) {
    return fromError(res, e);
  }
}

import type { Request, Response } from "express";
import { foModel } from "../../models/front-office/index.js";
import { reservationDisplayNo } from "../../services/front-office/reservation-lookup.js";
import {
  buildActiveBookingByRoomNo,
  deriveFoRoomStatus,
  fetchHkStatusByRoomIds,
} from "../../services/front-office/room-hk-status.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import { isArrivingTodayReservation } from "../../utils/date.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Reservation = Record<string, unknown>;
type Room = Record<string, unknown>;
type Payment = Record<string, unknown>;

const REPORT_TYPES = [
  "arrival",
  "departure",
  "occupancy",
  "revenue",
  "cashier",
  "night-audit",
  "guest",
  "room",
  "tax",
] as const;

export async function getReport(req: Request, res: Response) {
  try {
    const type = String(req.params.type);
    if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) {
      return fail(res, `Unknown report type: ${type}`, 404);
    }

    const [reservationsRaw, rooms, payments, shifts] = await Promise.all([
      foModel.list<Reservation>(foModel.tables.reservations),
      foModel.list<Room>(foModel.tables.rooms),
      foModel.list<Payment>(foModel.tables.payments),
      foModel.list(foModel.tables.cashierShifts),
    ]);
    const reservations = await enrichReservations(
      reservationsRaw as unknown as import("../../types/front-office.js").Reservation[],
    );

    const hkByRoomId = await fetchHkStatusByRoomIds(
      rooms.map((room) => String(room.id)),
    );
    const bookingByRoom = buildActiveBookingByRoomNo(reservations);

    const roomRevenue = reservations.reduce(
      (s, r) => s + Number(r.totalAmount ?? 0),
      0,
    );
    const paymentTotal = payments.reduce(
      (s, p) => s + Number(p.amount ?? 0),
      0,
    );
    const occupied = reservations.filter(
      (r) => r.status === "Checked In" || r.status === "In-House",
    ).length;
    const totalRooms = rooms.length || 1;

    const rows = (() => {
      switch (type) {
        case "arrival":
          return reservations
            .filter(
              (r) =>
                isArrivingTodayReservation(r) &&
                r.status !== "Cancelled" &&
                r.status !== "Checked Out",
            )
            .map((r) => ({
              bookingId: reservationDisplayNo(r),
              guest: r.guestName,
              room: r.roomNo,
              roomType: r.roomType,
              checkIn: r.checkIn,
              status: r.status,
              source: r.source,
            }));
        case "departure":
          return reservations
            .filter((r) => r.status === "Checked In" || r.status === "Checked Out")
            .map((r) => ({
              bookingId: reservationDisplayNo(r),
              guest: r.guestName,
              room: r.roomNo,
              checkOut: r.checkOut,
              balance: r.balance,
              status: r.status,
            }));
        case "occupancy":
          return rooms.map((r) => {
            const roomNo = String(r.roomNo);
            const hkStatus = hkByRoomId.get(String(r.id)) ?? "DIRTY";
            const booking = bookingByRoom.get(roomNo);
            return {
              room: roomNo,
              type: r.roomType,
              floor: r.floor,
              status: deriveFoRoomStatus(
                hkStatus,
                booking,
                r.isActive !== false,
              ),
              guest: booking
                ? String(booking.guestName ?? "—")
                : "—",
            };
          });
        case "revenue":
          return reservations.map((r) => ({
            bookingId: reservationDisplayNo(r),
            guest: r.guestName,
            roomRevenue: r.totalAmount,
            advancePaid: r.advancePaid,
            balance: r.balance,
            status: r.status,
          }));
        case "cashier":
          return shifts;
        case "guest":
          return reservations.map((r) => ({
            guest: r.guestName,
            phone: r.phone,
            email: r.email,
            nationality: r.nationality,
            status: r.status,
            room: r.roomNo,
          }));
        case "room":
          return rooms;
        case "tax":
          return reservations.map((r) => {
            const amount = Number(r.totalAmount ?? 0);
            const gst = Math.round(amount * 0.12);
            return {
              bookingId: reservationDisplayNo(r),
              guest: r.guestName,
              taxableAmount: amount,
              gst,
              total: amount + gst,
            };
          });
        case "night-audit":
          return [
            {
              metric: "Occupancy",
              value: `${Math.round((occupied / totalRooms) * 100)}%`,
            },
            { metric: "In-House", value: String(occupied) },
            {
              metric: "Room Revenue",
              value: `₹${roomRevenue.toLocaleString("en-IN")}`,
            },
            {
              metric: "Payments Collected",
              value: `₹${paymentTotal.toLocaleString("en-IN")}`,
            },
            {
              metric: "Open Balances",
              value: `₹${reservations
                .reduce((s, r) => s + Number(r.balance ?? 0), 0)
                .toLocaleString("en-IN")}`,
            },
          ];
        default:
          return [];
      }
    })();

    const summary = {
      occupancy: Math.round((occupied / totalRooms) * 100),
      roomRevenue,
      paymentTotal,
      reservationCount: reservations.length,
      inHouse: occupied,
    };

    return ok(res, {
      type,
      title: type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      summary,
      rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

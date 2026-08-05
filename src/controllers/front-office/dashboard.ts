import type { Request, Response } from "express";
import { foModel } from "../../models/front-office/index.js";
import { isArrivingTodayReservation } from "../../utils/date.js";
import { fromError, ok } from "../../utils/response.js";

type Reservation = Record<string, unknown>;
type Room = Record<string, unknown>;

export async function getDashboard(_req: Request, res: Response) {
  try {
    const [reservations, rooms, activity] = await Promise.all([
      foModel.list<Reservation>(foModel.tables.reservations),
      foModel.list<Room>(foModel.tables.rooms),
      foModel.list(foModel.tables.deskActivity, {
        orderBy: "id",
        ascending: false,
        limit: 20,
      }),
    ]);

    const inHouse = reservations.filter(
      (r) => r.status === "Checked In" || r.status === "In-House",
    );
    const arrivals = reservations.filter(
      (r) =>
        isArrivingTodayReservation(r) &&
        r.status !== "Cancelled" &&
        r.status !== "Checked Out",
    );
    const departures = reservations.filter(
      (r) => r.status === "Checked In",
    );

    const occupied = rooms.filter((r) => r.status === "Occupied").length;
    const total = rooms.length || 1;

    const statusCounts: Record<string, number> = {};
    for (const room of rooms) {
      const s = String(room.status);
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    const colorMap: Record<string, string> = {
      Occupied: "#16a34a",
      Vacant: "#22c55e",
      Dirty: "#eab308",
      Maintenance: "#ef4444",
      Blocked: "#64748b",
    };

    const stats = [
      {
        title: "Occupancy",
        value: `${Math.round((occupied / total) * 100)}%`,
        note: `${occupied}/${total} rooms`,
        trend: "up" as const,
      },
      {
        title: "Arrivals Today",
        value: String(arrivals.length),
        note: "Expected arrivals",
        trend: "neutral" as const,
      },
      {
        title: "In-House",
        value: String(inHouse.length),
        note: "Currently staying",
        trend: "up" as const,
      },
      {
        title: "Outstanding",
        value: `₹${reservations
          .reduce((sum, r) => sum + Number(r.balance ?? 0), 0)
          .toLocaleString("en-IN")}`,
        note: "Open balances",
        trend: "down" as const,
      },
    ];

    const todaysArrivals = arrivals
      .slice(0, 10)
      .map((a) => ({
        id: a.id,
        name: a.guestName,
        bookingId: a.id,
        roomNo: a.roomNo ?? "TBA",
        roomType: a.roomType ?? "",
        status: a.status,
      }));

    const todaysDepartures = departures.slice(0, 10).map((d) => ({
      id: d.id,
      name: d.guestName,
      bookingId: d.id,
      roomNo: d.roomNo ?? "",
      roomType: d.roomType ?? "",
      status: "Pending",
    }));

    const roomInventory = {
      percentage: Math.round((occupied / total) * 100),
      occupied,
      total,
      statuses: Object.entries(statusCounts).map(([label, count]) => ({
        label,
        count,
        color: colorMap[label] ?? "#94a3b8",
      })),
    };

    const sourceMap: Record<string, number> = {};
    for (const r of reservations) {
      const s = String(r.source ?? "Other");
      sourceMap[s] = (sourceMap[s] ?? 0) + 1;
    }
    const colors = ["#16a34a", "#22c55e", "#a855f7", "#eab308", "#3b82f6"];
    const bookingSources = Object.entries(sourceMap).map(([name, value], i) => ({
      name,
      value,
      color: colors[i % colors.length],
    }));

    const weeklyFlow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
      (day) => ({
        day,
        checkIn: Math.floor(Math.random() * 5) + inHouse.length,
        checkOut: Math.floor(Math.random() * 4) + 1,
      }),
    );

    return ok(res, {
      stats,
      todaysArrivals,
      todaysDepartures,
      roomInventory,
      weeklyFlow,
      bookingSources,
      deskActivity: activity,
    });
  } catch (e) {
    return fromError(res, e);
  }
}

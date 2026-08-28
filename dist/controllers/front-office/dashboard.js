import { foModel } from "../../models/front-office/index.js";
import { reservationDisplayNo } from "../../services/front-office/reservation-lookup.js";
import { buildActiveBookingByRoomNo, deriveFoRoomStatus, fetchHkStatusByRoomIds, } from "../../services/front-office/room-hk-status.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import { isArrivingTodayReservation } from "../../utils/date.js";
import { fromError, ok } from "../../utils/response.js";
export async function getDashboard(_req, res) {
    try {
        const [reservationsRaw, rooms, activity] = await Promise.all([
            foModel.list(foModel.tables.reservations),
            foModel.list(foModel.tables.rooms),
            foModel.list(foModel.tables.deskActivity, {
                orderBy: "id",
                ascending: false,
                limit: 20,
            }),
        ]);
        const reservations = await enrichReservations(reservationsRaw);
        const inHouse = reservations.filter((r) => r.status === "Checked In" || r.status === "In-House");
        const arrivals = reservations.filter((r) => isArrivingTodayReservation(r) &&
            r.status !== "Cancelled" &&
            r.status !== "Checked Out");
        const departures = reservations.filter((r) => r.status === "Checked In");
        const hkByRoomId = await fetchHkStatusByRoomIds(rooms.map((room) => String(room.id)));
        const bookingByRoom = buildActiveBookingByRoomNo(reservations);
        const occupied = inHouse.length;
        const total = rooms.length || 1;
        const statusCounts = {};
        for (const room of rooms) {
            const roomNo = String(room.roomNo);
            const hkStatus = hkByRoomId.get(String(room.id)) ?? "DIRTY";
            const status = deriveFoRoomStatus(hkStatus, bookingByRoom.get(roomNo), room.isActive !== false);
            statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        }
        const colorMap = {
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
                trend: "up",
            },
            {
                title: "Arrivals Today",
                value: String(arrivals.length),
                note: "Expected arrivals",
                trend: "neutral",
            },
            {
                title: "In-House",
                value: String(inHouse.length),
                note: "Currently staying",
                trend: "up",
            },
            {
                title: "Outstanding",
                value: `₹${reservations
                    .reduce((sum, r) => sum + Number(r.balance ?? 0), 0)
                    .toLocaleString("en-IN")}`,
                note: "Open balances",
                trend: "down",
            },
        ];
        const todaysArrivals = arrivals
            .slice(0, 10)
            .map((a) => ({
            id: a.id,
            name: a.guestName,
            bookingId: reservationDisplayNo(a),
            roomNo: a.roomNo ?? "TBA",
            roomType: a.roomType ?? "",
            status: a.status,
        }));
        const todaysDepartures = departures.slice(0, 10).map((d) => ({
            id: d.id,
            name: d.guestName,
            bookingId: reservationDisplayNo(d),
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
        const sourceMap = {};
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
        const weeklyFlow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({
            day,
            checkIn: Math.floor(Math.random() * 5) + inHouse.length,
            checkOut: Math.floor(Math.random() * 4) + 1,
        }));
        return ok(res, {
            stats,
            todaysArrivals,
            todaysDepartures,
            roomInventory,
            weeklyFlow,
            bookingSources,
            deskActivity: activity,
        });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=dashboard.js.map
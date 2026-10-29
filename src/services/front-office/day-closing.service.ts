import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { enrichReservations } from "./reservation-enrich.js";
import {
  buildActiveBookingByRoomNo,
  deriveFoRoomStatus,
  fetchHkStatusByRoomIds,
  localTodayIso,
} from "./room-hk-status.js";
import type { Reservation } from "../../types/front-office.js";

type Row = Record<string, unknown>;

/** Business dates are Indian calendar days; transaction timestamps are stored in UTC. */
const PROPERTY_UTC_OFFSET = "+05:30";

const IN_HOUSE = new Set(["Checked In", "In-House"]);
const CLOSED_RESERVATION = new Set(["Cancelled", "Checked Out", "No Show"]);
const OPEN_MAINTENANCE = new Set(["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_VERIFICATION"]);
const URGENT_MAINTENANCE = new Set(["HIGH", "CRITICAL"]);

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export type DayClosingCheck = {
  id: string;
  label: string;
  mandatory: boolean;
  passed: boolean;
  detail: string;
  href?: string;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isoDay(value: unknown) {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function lastClosing() {
  const rows = await foModel.list<Row>(foModel.tables.dayClosings, {
    orderBy: "created_at",
    ascending: false,
    limit: 1,
  });
  return rows[0] ?? null;
}

async function currentBusinessDate() {
  const last = await lastClosing();
  const next = isoDay(last?.nextBusinessDate);
  return { businessDate: next || localTodayIso(), last };
}

async function transactionsOn(businessDate: string) {
  const propertyId = getActivePropertyId();
  let query = supabase
    .from(foModel.tables.transactions)
    .select("transaction_type, payment_method, amount, status, source_module")
    .gte("transaction_date", `${businessDate}T00:00:00${PROPERTY_UTC_OFFSET}`)
    .lt("transaction_date", `${addDays(businessDate, 1)}T00:00:00${PROPERTY_UTC_OFFSET}`);
  if (propertyId) query = query.eq("property_id", propertyId);
  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as Row[];
}

async function userNames(ids: string[]) {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabase.from("users").select("id, name, email").in("id", unique);
  for (const u of (data ?? []) as { id: string; name: string | null; email: string | null }[]) {
    map.set(u.id, u.name || u.email || "Unknown user");
  }
  return map;
}

async function safeList(table: string) {
  try {
    return await foModel.list<Row>(table);
  } catch {
    return [] as Row[];
  }
}

export const DayClosingService = {
  async status() {
    if (!getActivePropertyId()) throw new AppError("Select a property first");
    const { businessDate, last } = await currentBusinessDate();

    const [reservationsRaw, rooms, txns, sessions, folios, maintenance, laundry, luggage, bills] =
      await Promise.all([
        foModel.list<Reservation>(foModel.tables.reservations),
        foModel.list<Row>(foModel.tables.rooms),
        transactionsOn(businessDate),
        foModel.list<Row>(foModel.tables.cashierSessions),
        foModel.list<Row>(foModel.tables.folios, { filters: { status: "OPEN" } }),
        safeList(foModel.tables.maintenanceRequests),
        safeList(hkModel.tables.laundryJobs),
        safeList(foModel.tables.luggageItems),
        fbModel.list<Row>(fbModel.tables.bills).catch(() => [] as Row[]),
      ]);
    const reservations = await enrichReservations(reservationsRaw);

    // Guests and rooms
    const inHouse = reservations.filter((r) => IN_HOUSE.has(String(r.status)));
    const dueOut = inHouse.filter((r) => {
      const out = isoDay(r.checkOut);
      return !out || out <= businessDate;
    });
    const stayingOver = inHouse.filter((r) => !dueOut.includes(r));
    const pendingArrivals = reservations.filter(
      (r) =>
        isoDay(r.checkIn) === businessDate &&
        !IN_HOUSE.has(String(r.status)) &&
        !CLOSED_RESERVATION.has(String(r.status)),
    );
    const arrivedToday = reservations.filter(
      (r) => isoDay(r.checkIn) === businessDate && IN_HOUSE.has(String(r.status)),
    ).length;
    const departedToday = reservations.filter(
      (r) => String(r.status) === "Checked Out" && isoDay(r.checkOut) === businessDate,
    ).length;

    const hkByRoom = await fetchHkStatusByRoomIds(rooms.map((r) => String(r.id)));
    const bookingByRoom = buildActiveBookingByRoomNo(reservations, businessDate);
    const roomCounts = { total: rooms.length, occupied: 0, vacant: 0, dirty: 0, clean: 0, inspected: 0, outOfOrder: 0 };
    for (const room of rooms) {
      const hk = hkByRoom.get(String(room.id)) ?? "DIRTY";
      const fo = deriveFoRoomStatus(hk, bookingByRoom.get(String(room.roomNo)), room.isActive !== false);
      if (fo === "Occupied") roomCounts.occupied += 1;
      else if (room.isActive !== false && hk !== "OUT_OF_SERVICE") roomCounts.vacant += 1;
      if (hk === "OUT_OF_SERVICE" || room.isActive === false) roomCounts.outOfOrder += 1;
      else if (hk === "DIRTY") roomCounts.dirty += 1;
      else if (hk === "INSPECTED") roomCounts.inspected += 1;
      else roomCounts.clean += 1;
    }
    const sellable = Math.max(0, roomCounts.total - roomCounts.outOfOrder);
    const occupancy = sellable ? Math.round((roomCounts.occupied / sellable) * 1000) / 10 : 0;
    const roomRevenue = round2(stayingOver.reduce((sum, r) => sum + num(r.roomRate), 0));
    const adr = stayingOver.length ? round2(roomRevenue / stayingOver.length) : 0;
    const revpar = sellable ? round2(roomRevenue / sellable) : 0;

    // Collections from posted transactions
    const methods = new Map<string, number>();
    let refunds = 0;
    let frontOffice = 0;
    let fnb = 0;
    let other = 0;
    for (const t of txns) {
      const status = String(t.status ?? "");
      if (status !== "COMPLETED" && status !== "REFUNDED") continue;
      const amount = num(t.amount);
      const type = String(t.transactionType ?? "PAYMENT");
      if (type === "REFUND") {
        refunds += amount;
        continue;
      }
      if (type !== "PAYMENT") continue;
      const method = METHOD_LABELS[String(t.paymentMethod)] ? String(t.paymentMethod) : "OTHER";
      methods.set(method, (methods.get(method) ?? 0) + amount);
      const source = String(t.sourceModule ?? "");
      if (source === "FRONT_OFFICE" || source === "RESERVATION") frontOffice += amount;
      else if (source === "FNB") fnb += amount;
      else other += amount;
    }
    const gross = [...methods.values()].reduce((a, b) => a + b, 0);
    const collections = {
      byMethod: Object.keys(METHOD_LABELS).map((key) => ({
        method: key,
        label: METHOD_LABELS[key],
        amount: round2(methods.get(key) ?? 0),
      })),
      gross: round2(gross),
      refunds: round2(refunds),
      net: round2(gross - refunds),
      bySource: { frontOffice: round2(frontOffice), fnb: round2(fnb), other: round2(other) },
      count: txns.length,
    };
    const outstanding = round2(folios.reduce((sum, f) => sum + num(f.balanceAmount), 0));

    // Cashier shifts
    const names = await userNames(sessions.map((s) => String(s.cashierId ?? "")));
    const unsettledSessions = sessions
      .filter((s) => ["Open", "Rejected", "Pending Approval"].includes(String(s.status)))
      .map((s) => ({
        id: String(s.id),
        cashierName: names.get(String(s.cashierId)) ?? "Unknown cashier",
        shiftName: String(s.shiftName ?? ""),
        openedAt: String(s.openedAt ?? ""),
        status: String(s.status),
      }));
    const openShifts = unsettledSessions.filter((s) => s.status !== "Pending Approval");
    const awaitingApproval = unsettledSessions.filter((s) => s.status === "Pending Approval");

    // Other departments
    const openMaintenance = maintenance.filter((m) => OPEN_MAINTENANCE.has(String(m.status)));
    const urgentMaintenance = openMaintenance.filter((m) => URGENT_MAINTENANCE.has(String(m.priority)));
    const pendingLaundry = laundry.filter((j) => j.cancelled !== true && String(j.status) !== "Delivered");
    const storedLuggage = luggage.filter((l) => String(l.status ?? "Stored") === "Stored");
    const openBills = bills.filter(
      (b) => String(b.status ?? "OPEN").toUpperCase() !== "CLOSED" && String(b.paymentStatus ?? "UNPAID").toUpperCase() !== "PAID",
    );

    const checks: DayClosingCheck[] = [
      {
        id: "cashier",
        label: "All cashier shifts closed",
        mandatory: true,
        passed: openShifts.length === 0,
        detail: openShifts.length ? `${plural(openShifts.length, "shift")} still open` : "No open shifts",
        href: "/frontoffice/cashier/session",
      },
      {
        id: "approvals",
        label: "Cashier closings approved",
        mandatory: true,
        passed: awaitingApproval.length === 0,
        detail: awaitingApproval.length
          ? `${plural(awaitingApproval.length, "closing")} awaiting approval`
          : "Nothing awaiting approval",
        href: "/frontoffice/cashier/history",
      },
      {
        id: "departures",
        label: "Due check-outs completed",
        mandatory: true,
        passed: dueOut.length === 0,
        detail: dueOut.length
          ? `${plural(dueOut.length, "guest")} due out but still checked in`
          : "No pending departures",
        href: "/frontoffice/reservation/check-out",
      },
      {
        id: "arrivals",
        label: "Today's arrivals handled",
        mandatory: false,
        passed: pendingArrivals.length === 0,
        detail: pendingArrivals.length
          ? `${plural(pendingArrivals.length, "arrival")} not checked in — check in, cancel or mark no-show`
          : "All arrivals handled",
        href: "/frontoffice/reservation/check-in",
      },
      {
        id: "maintenance",
        label: "No urgent maintenance open",
        mandatory: false,
        passed: urgentMaintenance.length === 0,
        detail: urgentMaintenance.length
          ? `${plural(urgentMaintenance.length, "high-priority ticket")} open`
          : openMaintenance.length
            ? `${plural(openMaintenance.length, "routine ticket")} open`
            : "No open tickets",
        href: "/maintenance/requests",
      },
      {
        id: "fnb",
        label: "Restaurant bills settled",
        mandatory: false,
        passed: openBills.length === 0,
        detail: openBills.length ? `${plural(openBills.length, "open bill")} across outlets` : "No open bills",
        href: "/food-beverages/restaurants/bills",
      },
    ];

    const today = localTodayIso();
    const closedFor = await foModel.list<Row>(foModel.tables.dayClosings, {
      filters: { business_date: businessDate },
      limit: 1,
    });

    return {
      businessDate,
      calendarDate: today,
      isBehind: businessDate < today,
      canCloseDate: businessDate <= today && closedFor.length === 0,
      lastClosing: last,
      checks,
      blockers: checks.filter((c) => c.mandatory && !c.passed).length,
      guests: {
        inHouse: inHouse.length,
        stayingOver: stayingOver.length,
        arrivedToday,
        departedToday,
        pendingArrivals: pendingArrivals.length,
      },
      rooms: { ...roomCounts, sellable, occupancy, roomRevenue, adr, revpar },
      collections,
      outstanding,
      departments: {
        laundryPending: pendingLaundry.length,
        luggageStored: storedLuggage.length,
        maintenanceOpen: openMaintenance.length,
        maintenanceUrgent: urgentMaintenance.length,
        fnbOpenBills: openBills.length,
      },
      dueOut: dueOut.map((r) => ({
        id: r.id,
        guestName: r.guestName ?? "Guest",
        roomNo: r.roomNo ?? "",
        checkOut: isoDay(r.checkOut),
        balance: num(r.balance),
      })),
      pendingArrivalList: pendingArrivals.map((r) => ({
        id: r.id,
        guestName: r.guestName ?? "Guest",
        roomNo: r.roomNo ?? "",
        status: String(r.status ?? ""),
      })),
      unsettledSessions,
    };
  },

  async run() {
    const status = await this.status();
    if (!status.canCloseDate) {
      throw new AppError(
        status.businessDate > status.calendarDate
          ? "This business date is in the future. Run day closing on that date."
          : "This business date is already closed.",
        409,
      );
    }
    if (status.blockers > 0) {
      const pending = status.checks.filter((c) => c.mandatory && !c.passed).map((c) => c.label);
      throw new AppError(`Resolve mandatory checks first: ${pending.join(", ")}`, 409);
    }

    const store = getRequestStore();
    const names = await userNames([String(store?.userId ?? "")]);
    const nextBusinessDate = addDays(status.businessDate, 1);
    const otherRevenue = round2(status.collections.bySource.other);

    return foModel.create<Row>(foModel.tables.dayClosings, {
      id: foModel.newId("DC"),
      businessDate: status.businessDate,
      totalRevenue: status.collections.net,
      roomRevenue: status.rooms.roomRevenue,
      fbRevenue: status.collections.bySource.fnb,
      otherRevenue,
      occupancy: status.rooms.occupancy,
      arrivals: status.guests.arrivedToday,
      departures: status.guests.departedToday,
      inHouse: status.guests.inHouse,
      pendingCheckouts: status.dueOut.length,
      closedAt: new Date().toISOString(),
      closedBy: names.get(String(store?.userId ?? "")) ?? "Unknown user",
      nextBusinessDate,
      steps: {
        checks: status.checks,
        rooms: status.rooms,
        collections: status.collections,
        outstanding: status.outstanding,
        departments: status.departments,
      },
    });
  },

  async history(limit = 30) {
    return foModel.list<Row>(foModel.tables.dayClosings, {
      orderBy: "created_at",
      ascending: false,
      limit,
    });
  },
};

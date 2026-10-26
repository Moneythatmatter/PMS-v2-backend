import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError } from "../../errors/index.js";
import { todayIso } from "../../utils/date.js";
import { PropertyService } from "./property.service.js";

export type PortfolioProperty = {
  id: string;
  name: string;
  code: string;
  city: string;
  rooms: number;
  occupied: number;
  occupancyPct: number;
  inHouse: number;
  arrivals: number;
  departures: number;
  reservations: number;
  roomRevenue: number;
  outstanding: number;
  dirtyRooms: number;
  openOrders: number;
  employees: number;
  openWorkOrders: number;
  pendingPurchases: number;
  openDeals: number;
  bookings: number;
  revenue: number;
  earnedRoomRevenue: number;
  roomNightsSold: number;
  availableRoomNights: number;
  periodOccupancyPct: number;
  adr: number;
  revpar: number;
  fbRevenue: number;
  fbOrders: number;
  payrollCost: number;
  purchaseSpend: number;
  expenses: number;
  profit: number;
  cancellations: number;
  noShows: number;
  stayNights: number;
  stayCount: number;
  avgLos: number;
  oooRooms: number;
  pendingPayroll: number;
  unpaidPayroll: number;
  pendingLeaves: number;
  overdueWorkOrders: number;
  absentToday: number;
  prevRevenue: number;
  prevFbRevenue: number;
  prevRoomNightsSold: number;
  prevAvailableRoomNights: number;
  prevExpenses: number;
};

export type PortfolioSeriesPoint = {
  month: string;
  booked: number;
  canceled: number;
  revenue: number;
};

export type PortfolioPlatform = {
  name: string;
  count: number;
};

export type PortfolioMovement = {
  id: string;
  kind: "arrival" | "departure" | "stay";
  propertyId: string;
  propertyName: string;
  guest: string;
  bookingNo: string;
  room: string;
  status: string;
  amount: number;
  balance: number;
  checkIn: string;
  checkOut: string;
};

export type PortfolioTrendPoint = {
  propertyId: string;
  label: string;
  sort: string;
  roomRevenue: number;
  fbRevenue: number;
  roomNightsSold: number;
  availableRoomNights: number;
};

export type PortfolioAlert = {
  id: string;
  propertyId: string;
  propertyName: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
  owner: string;
  href: string;
};

export type PortfolioSnapshot = {
  from: string;
  to: string;
  totals: Omit<PortfolioProperty, "id" | "name" | "code" | "city"> & {
    properties: number;
  };
  properties: PortfolioProperty[];
  series: PortfolioSeriesPoint[];
  platforms: PortfolioPlatform[];
  arrivals: PortfolioMovement[];
  departures: PortfolioMovement[];
  staying: PortfolioMovement[];
  trend: PortfolioTrendPoint[];
  alerts: PortfolioAlert[];
  coverage: { fb: boolean; purchases: boolean };
  definitions: {
    revenue: string;
    expenses: string;
    profit: string;
    occupancy: string;
  };
};

type RoomRow = {
  id?: string;
  propertyId?: string;
  isActive?: boolean;
  roomNo?: string;
  roomType?: string;
};
type ReservationRow = {
  id?: string;
  propertyId?: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  balance?: number;
  totalAmount?: number;
  bookingNo?: string;
  guestId?: string;
  roomRefId?: string;
  sourceId?: string;
  createdAt?: string;
  nights?: number;
  roomRate?: number;
};
type GuestRow = { id?: string; name?: string };

const PAGE = 1000;

function isoDay(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return "";
  return todayIso(new Date(parsed));
}

function inRange(day: string, from: string, to: string) {
  return Boolean(day) && day >= from && day <= to;
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

function daysInclusive(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd).getTime();
  const end = new Date(ty, tm - 1, td).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86400000) + 1;
}

function nightsBetween(start: string, endExclusive: string) {
  if (!start || !endExclusive || endExclusive <= start) return 0;
  return daysInclusive(start, addDays(endExclusive, -1));
}

function isNoShow(status: string) {
  const value = status.toLowerCase().replace(/[\s_-]/g, "");
  return value === "noshow";
}

const DEFINITIONS = {
  revenue:
    "Room charges for nights inside the period, plus F&B order totals when those orders are stored on a property. A payment against an existing bill is not counted again.",
  expenses:
    "Payroll net salary for each month the period touches, plus purchase orders stored on a property. This is not a full expense ledger.",
  profit:
    "That revenue minus those recorded expenses. Cash, bank, tax, and accounts-module entries are not included.",
  occupancy:
    "Room-nights sold divided by room-nights available. Available rooms are active rooms, excluding rooms marked out of order today.",
};

function isCancelled(status: string) {
  return status === "Cancelled" || status === "Canceled";
}

function isInHouse(status: string) {
  return status === "Checked In" || status === "In-House";
}

async function selectForProperties<T>(
  table: string,
  columns: string,
  propertyIds: string[],
): Promise<T[]> {
  const rows: unknown[] = [];
  let start = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in("property_id", propertyIds)
      .range(start, start + PAGE - 1);
    if (error) throw new AppError(error.message, 500);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    start += PAGE;
    if (start > 50000) break;
  }
  return toCamel<T[]>(rows);
}

function emptyRow(): Omit<PortfolioProperty, "id" | "name" | "code" | "city"> {
  return {
    rooms: 0,
    occupied: 0,
    occupancyPct: 0,
    inHouse: 0,
    arrivals: 0,
    departures: 0,
    reservations: 0,
    roomRevenue: 0,
    outstanding: 0,
    dirtyRooms: 0,
    openOrders: 0,
    employees: 0,
    openWorkOrders: 0,
    pendingPurchases: 0,
    openDeals: 0,
    bookings: 0,
    revenue: 0,
    earnedRoomRevenue: 0,
    roomNightsSold: 0,
    availableRoomNights: 0,
    periodOccupancyPct: 0,
    adr: 0,
    revpar: 0,
    fbRevenue: 0,
    fbOrders: 0,
    payrollCost: 0,
    purchaseSpend: 0,
    expenses: 0,
    profit: 0,
    cancellations: 0,
    noShows: 0,
    stayNights: 0,
    stayCount: 0,
    avgLos: 0,
    oooRooms: 0,
    pendingPayroll: 0,
    unpaidPayroll: 0,
    pendingLeaves: 0,
    overdueWorkOrders: 0,
    absentToday: 0,
    prevRevenue: 0,
    prevFbRevenue: 0,
    prevRoomNightsSold: 0,
    prevAvailableRoomNights: 0,
    prevExpenses: 0,
  };
}

async function safeRows(table: string, columns: string, propertyIds: string[]) {
  try {
    return { ok: true, rows: await selectForProperties<Record<string, unknown>>(table, columns, propertyIds) };
  } catch {
    return { ok: false, rows: [] as Record<string, unknown>[] };
  }
}

export const PortfolioService = {
  async snapshot(input: {
    userId: string;
    isSuperAdmin?: boolean;
    role?: string;
    from?: string;
    to?: string;
  }): Promise<PortfolioSnapshot> {
    const today = todayIso();
    let from = isoDay(input.from) || today;
    let to = isoDay(input.to) || from;
    if (from > to) [from, to] = [to, from];

    const properties = await PropertyService.listForUser(
      input.userId,
      input.isSuperAdmin,
      input.role,
    );
    const ids = properties.map((p) => p.id);
    if (!ids.length) {
      return {
        from,
        to,
        totals: { properties: 0, ...emptyRow() },
        properties: [],
        series: [],
        platforms: [],
        arrivals: [],
        departures: [],
        staying: [],
        trend: [],
        alerts: [],
        coverage: { fb: false, purchases: false },
        definitions: DEFINITIONS,
      };
    }

    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(daysInclusive(from, to) - 1));
    const spanDays = daysInclusive(from, to);
    const trendMode: "day" | "week" | "month" = spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";

    const [rooms, reservations, guests, hkRooms, fbOrders, hrEmployees, workOrders, requisitions, purchaseOrders, payroll, leaves, attendance, deals, sources] =
      await Promise.all([
      selectForProperties<RoomRow>("rooms", "id,property_id,is_active,room_no,room_type", ids),
      selectForProperties<ReservationRow>(
        "reservations",
        "id,property_id,status,check_in,check_out,balance,total_amount,booking_no,guest_id,room_ref_id,source_id,created_at,nights,room_rate",
        ids,
      ),
      selectForProperties<GuestRow>("guests", "id,name", ids),
      safeRows("hk_rooms", "property_id,status,hk_status", ids),
      safeRows("fb_orders", "property_id,status,amount,placed_at,created_at", ids),
      safeRows("hr_employees", "property_id,status", ids),
      safeRows("mnt_work_orders", "id,property_id,status,due_date,location,priority", ids),
      safeRows("purchase_requisitions", "id,property_id,status,pr_number,current_approver,estimated_amount", ids),
      safeRows("ps_purchase_orders", "property_id,status,order_date,total_amount", ids),
      safeRows("hr_payroll_records", "property_id,status,payroll_month,payroll_year,net_salary", ids),
      safeRows("hr_leave_applications", "property_id,status", ids),
      safeRows("hr_attendance_records", "property_id,status,attendance_date", ids),
      safeRows("sm_deals", "property_id,status", ids),
      safeRows("booking_sources", "id,name", ids),
    ]);

    const byId = new Map<string, PortfolioProperty>();
    for (const property of properties) {
      byId.set(property.id, {
        id: property.id,
        name: property.name,
        code: property.code,
        city: property.city ?? "",
        ...emptyRow(),
      });
    }

    const roomById = new Map<string, RoomRow>();
    for (const room of rooms) {
      if (room.id) roomById.set(room.id, room);
      const row = room.propertyId ? byId.get(room.propertyId) : undefined;
      if (!row || room.isActive === false) continue;
      row.rooms += 1;
    }
    const guestName = new Map(guests.map((guest) => [String(guest.id ?? ""), guest.name || "Guest"]));
    const sourceName = new Map(sources.rows.map((source) => [String(source.id ?? ""), String(source.name ?? "Direct")]));
    const trend = new Map<string, { roomRevenue: number; fbRevenue: number; roomNightsSold: number }>();
    const trendKey = (day: string) => {
      if (!day || trendMode === "day") return day;
      if (trendMode === "month") return day.slice(0, 7);
      const [y, m, d] = day.split("-").map(Number);
      const date = new Date(y, (m || 1) - 1, d || 1);
      const monday = new Date(date);
      const weekday = (date.getDay() + 6) % 7;
      monday.setDate(date.getDate() - weekday);
      return todayIso(monday);
    };
    const addTrend = (propertyId: string, day: string, roomRevenue = 0, fbRevenue = 0, sold = 0) => {
      if (!day || day < from || day > to) return;
      const key = `${propertyId}|${trendKey(day)}`;
      const point = trend.get(key) ?? { roomRevenue: 0, fbRevenue: 0, roomNightsSold: 0 };
      point.roomRevenue += roomRevenue;
      point.fbRevenue += fbRevenue;
      point.roomNightsSold += sold;
      trend.set(key, point);
    };
    const earnStay = (row: PortfolioProperty, checkIn: string, checkOut: string, nights: number, total: number, windowFrom: string, windowTo: string, recordTrend: boolean) => {
      const span = nights || nightsBetween(checkIn, checkOut) || (checkIn ? 1 : 0);
      if (!span || !checkIn) return { revenue: 0, sold: 0 };
      const end = checkOut && checkOut > checkIn ? checkOut : addDays(checkIn, span);
      const nightly = total / span;
      let sold = 0;
      let revenue = 0;
      for (let cursor = checkIn, guard = 0; cursor < end && guard < 400; cursor = addDays(cursor, 1), guard += 1) {
        if (cursor < windowFrom || cursor > windowTo) continue;
        sold += 1;
        revenue += nightly;
        if (recordTrend) addTrend(row.id, cursor, nightly, 0, 1);
      }
      return { revenue, sold };
    };
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        month: date.toLocaleString("en-IN", { month: "short" }),
        booked: 0,
        canceled: 0,
        revenue: 0,
      };
    });
    const monthIndex = new Map(months.map((point, index) => [point.key, index]));
    const platformCounts = new Map<string, number>();
    const arrivals: PortfolioMovement[] = [];
    const departures: PortfolioMovement[] = [];
    const staying: PortfolioMovement[] = [];

    for (const booking of reservations) {
      const row = booking.propertyId ? byId.get(booking.propertyId) : undefined;
      if (!row) continue;
      const status = String(booking.status ?? "");
      const checkIn = isoDay(booking.checkIn);
      const checkOut = isoDay(booking.checkOut);
      const created = isoDay(booking.createdAt) || checkIn;
      const bucket = monthIndex.get(created.slice(0, 7));
      if (isCancelled(status)) {
        if (bucket !== undefined) months[bucket].canceled += 1;
        if (inRange(checkIn, from, to) || inRange(created, from, to)) row.cancellations += 1;
        continue;
      }
      if (isNoShow(status)) {
        if (inRange(checkIn, from, to)) row.noShows += 1;
        continue;
      }
      const stayNights = Math.max(0, Number(booking.nights) || nightsBetween(checkIn, checkOut));
      const stayTotal = Number(booking.totalAmount ?? 0);
      const earned = earnStay(row, checkIn, checkOut, stayNights, stayTotal, from, to, true);
      const previous = earnStay(row, checkIn, checkOut, stayNights, stayTotal, prevFrom, prevTo, false);
      row.earnedRoomRevenue += earned.revenue;
      row.roomNightsSold += earned.sold;
      row.prevRevenue += previous.revenue;
      row.prevRoomNightsSold += previous.sold;
      if (inRange(checkIn, from, to)) {
        row.stayCount += 1;
        row.stayNights += stayNights || 1;
      }
      row.bookings += 1;
      row.revenue += Number(booking.totalAmount ?? 0);
      const platform = sourceName.get(String(booking.sourceId ?? "")) || "Direct";
      platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
      if (bucket !== undefined) {
        months[bucket].booked += 1;
        months[bucket].revenue += Number(booking.totalAmount ?? 0);
      }

      if (isInHouse(status)) {
        row.inHouse += 1;
        row.occupied += 1;
        row.outstanding += Number(booking.balance ?? 0);
      } else if (status !== "Checked Out") {
        row.outstanding += Number(booking.balance ?? 0);
      }
      const room = booking.roomRefId ? roomById.get(booking.roomRefId) : undefined;
      const movement = {
        id: String(booking.id ?? `${row.id}-${checkIn}-${arrivals.length + departures.length}`),
        propertyId: row.id,
        propertyName: row.name,
        guest: guestName.get(String(booking.guestId ?? "")) || "Guest",
        bookingNo: String(booking.bookingNo ?? "").trim() || "—",
        room: room?.roomNo ? String(room.roomNo) : "TBA",
        status,
        amount: Math.round(Number(booking.totalAmount ?? 0)),
        balance: Math.round(Number(booking.balance ?? 0)),
        checkIn,
        checkOut,
      };
      if (isInHouse(status) && staying.length < 80) {
        staying.push({ ...movement, kind: "stay" });
      }
      if (inRange(checkIn, from, to)) {
        row.arrivals += 1;
        row.reservations += 1;
        row.roomRevenue += Number(booking.totalAmount ?? 0);
        if (arrivals.length < 80) arrivals.push({ ...movement, kind: "arrival" });
      }
      if (inRange(checkOut, from, to)) {
        row.departures += 1;
        if (departures.length < 80) departures.push({ ...movement, kind: "departure" });
      }
    }

    const bump = (propertyId: unknown, field: keyof PortfolioProperty) => {
      const row = propertyId ? byId.get(String(propertyId)) : undefined;
      if (!row) return;
      (row[field] as number) += 1;
    };
    for (const room of hkRooms.rows) {
      const status = `${room.status ?? ""} ${room.hkStatus ?? ""}`.toUpperCase();
      if (status.includes("DIRTY") || status.includes("CLEANING")) bump(room.propertyId, "dirtyRooms");
      if (status.includes("OOO") || status.includes("OUT OF ORDER") || status.includes("OOS")) bump(room.propertyId, "oooRooms");
    }
    for (const order of fbOrders.rows) {
      const status = String(order.status ?? "");
      const cancelled = status === "Cancelled" || status === "Canceled" || status.toUpperCase() === "CANCELLED";
      if (!cancelled && status && status !== "Settled") bump(order.propertyId, "openOrders");
      if (cancelled) continue;
      const amount = Number(order.amount ?? 0);
      const day = isoDay(order.placedAt) || isoDay(order.createdAt);
      const target = order.propertyId ? byId.get(String(order.propertyId)) : undefined;
      if (!target || !amount) continue;
      if (inRange(day, from, to)) {
        target.fbRevenue += amount;
        target.fbOrders += 1;
        addTrend(target.id, day, 0, amount, 0);
      } else if (inRange(day, prevFrom, prevTo)) {
        target.prevFbRevenue += amount;
      }
    }
    for (const employee of hrEmployees.rows) {
      if (String(employee.status ?? "Active") === "Active" || !employee.status) bump(employee.propertyId, "employees");
    }
    const closedWork = new Set(["Completed", "Closed", "Cancelled", "Canceled"]);
    for (const order of workOrders.rows) {
      if (!closedWork.has(String(order.status ?? ""))) {
        bump(order.propertyId, "openWorkOrders");
        const due = isoDay(order.dueDate);
        if (due && due < today) bump(order.propertyId, "overdueWorkOrders");
      }
    }
    for (const req of requisitions.rows) {
      const status = String(req.status ?? "");
      if (status === "Pending Approval" || status === "Pending" || status === "Draft") {
        bump(req.propertyId, "pendingPurchases");
      }
    }
    const closedPo = new Set(["Draft", "Cancelled", "Canceled", "Rejected"]);
    for (const order of purchaseOrders.rows) {
      if (closedPo.has(String(order.status ?? ""))) continue;
      const day = isoDay(order.orderDate);
      const target = order.propertyId ? byId.get(String(order.propertyId)) : undefined;
      if (!target) continue;
      const amount = Number(order.totalAmount ?? 0);
      if (inRange(day, from, to)) target.purchaseSpend += amount;
      else if (inRange(day, prevFrom, prevTo)) target.prevExpenses += amount;
    }
    const monthOverlaps = (year: number, month: number, windowFrom: string, windowTo: string) => {
      if (!year || month < 1 || month > 12) return false;
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const last = todayIso(new Date(year, month, 0));
      return start <= windowTo && last >= windowFrom;
    };
    for (const record of payroll.rows) {
      const target = record.propertyId ? byId.get(String(record.propertyId)) : undefined;
      if (!target) continue;
      const status = String(record.status ?? "");
      const year = Number(record.payrollYear ?? 0);
      const month = Number(record.payrollMonth ?? 0);
      if (status === "Draft" || status === "Calculated") target.pendingPayroll += 1;
      if (status === "Approved") target.unpaidPayroll += 1;
      if (status === "Draft") continue;
      const net = Number(record.netSalary ?? 0);
      if (monthOverlaps(year, month, from, to)) target.payrollCost += net;
      else if (monthOverlaps(year, month, prevFrom, prevTo)) target.prevExpenses += net;
    }
    for (const leave of leaves.rows) {
      if (String(leave.status ?? "") === "Pending") bump(leave.propertyId, "pendingLeaves");
    }
    for (const record of attendance.rows) {
      if (isoDay(record.attendanceDate) !== today) continue;
      const status = String(record.status ?? "").toUpperCase();
      if (status === "ABSENT" || status === "A") bump(record.propertyId, "absentToday");
    }
    for (const deal of deals.rows) {
      if (String(deal.status ?? "") === "Open") bump(deal.propertyId, "openDeals");
    }

    const list = [...byId.values()].map((row) => {
      const sellable = Math.max(0, row.rooms - row.oooRooms);
      const availableRoomNights = sellable * spanDays;
      const prevAvailableRoomNights = sellable * daysInclusive(prevFrom, prevTo);
      const expenses = row.payrollCost + row.purchaseSpend;
      const earned = row.earnedRoomRevenue;
      return {
        ...row,
        occupancyPct: row.rooms ? Math.round((row.occupied / row.rooms) * 100) : 0,
        roomRevenue: Math.round(row.roomRevenue),
        outstanding: Math.round(row.outstanding),
        revenue: Math.round(row.revenue),
        earnedRoomRevenue: Math.round(earned),
        availableRoomNights,
        prevAvailableRoomNights,
        periodOccupancyPct: availableRoomNights ? Math.round((row.roomNightsSold / availableRoomNights) * 100) : 0,
        adr: row.roomNightsSold ? Math.round(earned / row.roomNightsSold) : 0,
        revpar: availableRoomNights ? Math.round(earned / availableRoomNights) : 0,
        fbRevenue: Math.round(row.fbRevenue),
        payrollCost: Math.round(row.payrollCost),
        purchaseSpend: Math.round(row.purchaseSpend),
        expenses: Math.round(expenses),
        profit: Math.round(earned + row.fbRevenue - expenses),
        avgLos: row.stayCount ? Math.round((row.stayNights / row.stayCount) * 10) / 10 : 0,
        prevRevenue: Math.round(row.prevRevenue),
        prevFbRevenue: Math.round(row.prevFbRevenue),
        prevExpenses: Math.round(row.prevExpenses),
      };
    });
    list.sort((a, b) => a.name.localeCompare(b.name));

    const totals = list.reduce((sum, row) => {
      const next = { ...sum, properties: sum.properties + 1 };
      (Object.keys(emptyRow()) as (keyof ReturnType<typeof emptyRow>)[]).forEach((key) => {
        next[key] += row[key];
      });
      return next;
    }, { properties: 0, ...emptyRow() });
    totals.occupancyPct = totals.rooms ? Math.round((totals.occupied / totals.rooms) * 100) : 0;
    totals.periodOccupancyPct = totals.availableRoomNights
      ? Math.round((totals.roomNightsSold / totals.availableRoomNights) * 100)
      : 0;
    totals.adr = totals.roomNightsSold ? Math.round(totals.earnedRoomRevenue / totals.roomNightsSold) : 0;
    totals.revpar = totals.availableRoomNights ? Math.round(totals.earnedRoomRevenue / totals.availableRoomNights) : 0;
    totals.avgLos = totals.stayCount ? Math.round((totals.stayNights / totals.stayCount) * 10) / 10 : 0;
    totals.expenses = Math.round(totals.payrollCost + totals.purchaseSpend);
    totals.profit = Math.round(totals.earnedRoomRevenue + totals.fbRevenue - totals.expenses);

    const platforms = [...platformCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const series = months.map(({ month, booked, canceled, revenue }) => ({
      month,
      booked,
      canceled,
      revenue: Math.round(revenue),
    }));

    const bucketDays = new Map<string, number>();
    for (let cursor = from, guard = 0; cursor <= to && guard < 400; cursor = addDays(cursor, 1), guard += 1) {
      const key = trendKey(cursor);
      bucketDays.set(key, (bucketDays.get(key) ?? 0) + 1);
    }
    const sellableByProperty = new Map(list.map((row) => [row.id, Math.max(0, row.rooms - row.oooRooms)]));
    const trendPoints: PortfolioTrendPoint[] = [...trend.entries()].map(([key, value]) => {
      const split = key.indexOf("|");
      const propertyId = key.slice(0, split);
      const sort = key.slice(split + 1);
      const [y, m, d] = sort.split("-").map(Number);
      const date = new Date(y, (m || 1) - 1, d || 1);
      const label = trendMode === "month"
        ? date.toLocaleString("en-IN", { month: "short" })
        : date.toLocaleString("en-IN", { day: "numeric", month: "short" });
      return {
        propertyId,
        label,
        sort,
        roomRevenue: Math.round(value.roomRevenue),
        fbRevenue: Math.round(value.fbRevenue),
        roomNightsSold: value.roomNightsSold,
        availableRoomNights: (sellableByProperty.get(propertyId) ?? 0) * (bucketDays.get(sort) ?? 1),
      };
    });
    trendPoints.sort((a, b) => a.sort.localeCompare(b.sort) || a.propertyId.localeCompare(b.propertyId));

    const alerts: PortfolioAlert[] = [];
    const pushAlert = (alert: PortfolioAlert) => alerts.push(alert);
    for (const row of list) {
      if (row.oooRooms > 0) {
        pushAlert({
          id: `${row.id}-ooo`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "high",
          title: "Rooms out of order",
          detail: `${row.oooRooms} room${row.oooRooms === 1 ? "" : "s"} marked out of order or out of service`,
          owner: "Housekeeping",
          href: "/housekeeping/operations/rooms",
        });
      }
      if (row.overdueWorkOrders > 0) {
        pushAlert({
          id: `${row.id}-wo`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "high",
          title: "Maintenance overdue",
          detail: `${row.overdueWorkOrders} work order${row.overdueWorkOrders === 1 ? "" : "s"} past the due date`,
          owner: "Maintenance",
          href: "/maintenance/work-orders",
        });
      }
      if (row.outstanding > 0) {
        pushAlert({
          id: `${row.id}-ar`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "medium",
          title: "Guest balances open",
          detail: `₹${Math.round(row.outstanding).toLocaleString("en-IN")} still open on folios`,
          owner: "Front office",
          href: "/frontoffice/in-house-guests",
        });
      }
      if (row.dirtyRooms > 0) {
        pushAlert({
          id: `${row.id}-hk`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "medium",
          title: "Rooms not ready",
          detail: `${row.dirtyRooms} room${row.dirtyRooms === 1 ? "" : "s"} dirty or in cleaning`,
          owner: "Housekeeping",
          href: "/housekeeping/operations/room-cleaning",
        });
      }
      if (row.pendingPayroll > 0) {
        pushAlert({
          id: `${row.id}-payroll`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "medium",
          title: "Payroll awaiting approval",
          detail: `${row.pendingPayroll} payroll record${row.pendingPayroll === 1 ? "" : "s"} still draft or calculated`,
          owner: "Human resources",
          href: "/human-resources/payroll/process-payroll",
        });
      }
      if (row.unpaidPayroll > 0) {
        pushAlert({
          id: `${row.id}-unpaid`,
          propertyId: row.id,
          propertyName: row.name,
          severity: "medium",
          title: "Approved salary not paid",
          detail: `${row.unpaidPayroll} approved payroll record${row.unpaidPayroll === 1 ? "" : "s"} not marked paid`,
          owner: "Human resources",
          href: "/human-resources/payroll/process-payroll",
        });
      }
    }
    for (const req of requisitions.rows) {
      const status = String(req.status ?? "");
      if (status !== "Pending Approval" && status !== "Pending") continue;
      const property = req.propertyId ? byId.get(String(req.propertyId)) : undefined;
      if (!property) continue;
      pushAlert({
        id: `pr-${String(req.id ?? alerts.length)}`,
        propertyId: property.id,
        propertyName: property.name,
        severity: "medium",
        title: "Purchase requisition waiting",
        detail: String(req.prNumber ?? "Requisition"),
        owner: String(req.currentApprover ?? "").trim() || "Purchase",
        href: "/purchase-stores/procurement/requisitions",
      });
    }
    alerts.sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high"));

    return {
      from,
      to,
      totals,
      properties: list,
      series,
      platforms,
      arrivals,
      departures,
      staying,
      trend: trendPoints,
      alerts: alerts.slice(0, 24),
      coverage: { fb: fbOrders.ok, purchases: purchaseOrders.ok && requisitions.ok },
      definitions: DEFINITIONS,
    };
  },
};

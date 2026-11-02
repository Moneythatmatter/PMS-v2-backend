import type { Request, Response } from "express";
import { foModel } from "../../models/front-office/index.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { fromError, ok } from "../../utils/response.js";

type Row = Record<string, unknown>;

const TZ = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PLATFORM_COLORS = ["#1e3a5f", "#22c55e", "#eab308", "#a855f7", "#ef4444", "#0ea5e9", "#f97316", "#64748b"];
const NOT_STAYING = new Set(["Cancelled", "No Show"]);

/** Indian calendar day (YYYY-MM-DD) of an ISO date, timestamp or "29 Oct 2026, 3:40 pm" display string. */
function dayOf(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let parsed = new Date(raw.replace(/\bSept\b/gi, "Sep"));
  if (Number.isNaN(parsed.getTime())) {
    const m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m) return "";
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (month < 0) return "";
    return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /[+-]\d{2}:?\d{2}$|Z$/.test(raw)) {
    return parsed.toLocaleDateString("en-CA", { timeZone: TZ });
  }
  parsed = new Date(parsed.getTime());
  const y = parsed.getFullYear();
  return `${y}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthKey(day: string) {
  return day.slice(0, 7);
}

/** The last `count` month keys ending with the month of `day`, oldest first. */
function lastMonths(day: string, count: number) {
  const [y, m] = day.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

function change(current: number, previous: number): { change: string; trend: "up" | "down" } {
  if (!previous) return { change: current ? "New" : "0%", trend: "up" };
  const pct = ((current - previous) / previous) * 100;
  return { change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, trend: pct >= 0 ? "up" : "down" };
}

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function relativeTime(value: unknown, now: number) {
  const t = new Date(String(value ?? "")).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(t).toLocaleDateString("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
}

const ACTIVITY_TYPES: Record<string, "booking" | "checkin" | "checkout" | "payment" | "maintenance"> = {
  RESERVATION_CREATED: "booking",
  RESERVATION_UPDATED: "booking",
  CHECK_IN: "checkin",
  CHECK_OUT: "checkout",
  PAYMENT: "payment",
};

/** Live numbers for the main dashboard, scoped to the selected property. */
export async function getMainDashboard(_req: Request, res: Response) {
  try {
    const propertyId = getActivePropertyId();
    const now = Date.now();
    const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
    const yesterday = addDays(today, -1);
    const monthStart = `${today.slice(0, 8)}01`;
    const dayOfMonth = Number(today.slice(8, 10));
    const prevMonthKey = lastMonths(today, 2)[0];
    const prevMonthSameDay = `${prevMonthKey}-${String(dayOfMonth).padStart(2, "0")}`;

    const [reservationsRaw, rooms, charges, bills, txns, feedback, activityRaw] = await Promise.all([
      foModel.list<Row>(foModel.tables.reservations),
      foModel.list<Row>(foModel.tables.rooms),
      foModel.list<Row>(foModel.tables.folioCharges),
      fbModel.list<Row>(fbModel.tables.bills),
      supabase
        .from("transactions")
        .select("id, transaction_type, payment_method, amount, status, source_module, created_at")
        .eq("property_id", propertyId ?? "")
        .order("created_at", { ascending: false })
        .limit(15),
      foModel.list<Row>(foModel.tables.guestFeedback).catch(() => [] as Row[]),
      foModel
        .list<Row>(foModel.tables.deskActivity, { orderBy: "created_at", ascending: false, limit: 15 })
        .catch(() => [] as Row[]),
    ]);
    const reservations = (await enrichReservations(
      reservationsRaw as unknown as import("../../types/front-office.js").Reservation[],
    )) as unknown as Row[];

    // Revenue = folio charges (room nights, extras, F&B to room) + F&B bills paid at the outlet.
    const chargedBillRefs = new Set(charges.map((c) => String(c.sourceId ?? "")));
    const revenueByDay = new Map<string, number>();
    const addRevenue = (day: string, amount: number) => {
      if (!day || !amount) return;
      revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + amount);
    };
    for (const c of charges) addRevenue(dayOf(c.businessDate ?? c.createdAt), Number(c.amount ?? 0));
    for (const b of bills) {
      if (/CANCEL|VOID/i.test(String(b.status ?? ""))) continue;
      if (chargedBillRefs.has(String(b.id)) || chargedBillRefs.has(String(b.orderId ?? ""))) continue;
      addRevenue(dayOf(b.billPrintedAt ?? b.createdAt), Number(b.subtotal ?? 0) - Number(b.discount ?? 0));
    }
    const revenueBetween = (from: string, to: string) =>
      [...revenueByDay].reduce((n, [d, v]) => (d >= from && d <= to ? n + v : n), 0);
    const revenueMtd = revenueBetween(monthStart, today);
    const revenuePrevMtd = revenueBetween(`${prevMonthKey}-01`, prevMonthSameDay);

    const created = reservations.map((r) => ({ r, day: dayOf(r.createdAt) }));
    const bookingsMtd = created.filter((x) => x.day >= monthStart && x.day <= today).length;
    const bookingsPrevMtd = created.filter((x) => x.day >= `${prevMonthKey}-01` && x.day <= prevMonthSameDay).length;

    const staying = reservations.filter((r) => !NOT_STAYING.has(String(r.status ?? "")));
    const arrivalsOn = (day: string) => staying.filter((r) => dayOf(r.checkIn) === day).length;
    const departuresOn = (day: string) => staying.filter((r) => dayOf(r.checkOut) === day).length;

    const summary = [
      { title: "Revenue (this month)", value: inr(revenueMtd), ...change(revenueMtd, revenuePrevMtd) },
      { title: "New Bookings (this month)", value: String(bookingsMtd), ...change(bookingsMtd, bookingsPrevMtd) },
      { title: "Check In (today)", value: String(arrivalsOn(today)), ...change(arrivalsOn(today), arrivalsOn(yesterday)) },
      { title: "Check Out (today)", value: String(departuresOn(today)), ...change(departuresOn(today), departuresOn(yesterday)) },
    ];

    const guests = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(today, i - 6);
      const count = staying.reduce((n, r) => {
        const inDay = dayOf(r.checkIn);
        const outDay = dayOf(r.checkOut) || inDay;
        const covers = inDay && inDay <= day && (day < outDay || (inDay === outDay && day === inDay));
        return covers ? n + Math.max(1, Number(r.adults ?? 0) + Number(r.children ?? 0)) : n;
      }, 0);
      return { day: WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()], count };
    });

    const revenue = lastMonths(today, 8).map((key) => ({
      month: MONTHS[Number(key.slice(5, 7)) - 1],
      amount: Math.round([...revenueByDay].reduce((n, [d, v]) => (monthKey(d) === key ? n + v : n), 0)),
    }));

    const months12 = lastMonths(today, 12);
    const bookingsChart = months12.map((key) => {
      const inMonth = created.filter((x) => monthKey(x.day) === key);
      const canceled = inMonth.filter((x) => x.r.status === "Cancelled").length;
      return { month: MONTHS[Number(key.slice(5, 7)) - 1], booked: inMonth.length - canceled, canceled };
    });

    const sourceCounts = new Map<string, number>();
    for (const { r, day } of created) {
      if (day && day < `${months12[0]}-01`) continue;
      const name = String(r.source ?? "").trim() || "Direct";
      sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1);
    }
    const platform = [...sourceCounts]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, color: PLATFORM_COLORS[i % PLATFORM_COLORS.length] }));

    const avg = (key: string) => {
      const vals = feedback.map((f) => Number(f[key])).filter((n) => Number.isFinite(n) && n > 0);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
    };
    const ratings = {
      overall: avg("rating"),
      maxScore: 10,
      count: feedback.length,
      categories: [
        { label: "Cleanliness", score: avg("cleanliness") },
        { label: "Food", score: avg("food") },
        { label: "Service", score: avg("service") },
      ],
    };

    const roomNoById = new Map(rooms.map((r) => [String(r.id), String(r.roomNo ?? "")]));
    const tidy = (message: string) =>
      message
        .replace(/^\[[A-Z_]+\]\s*/, "")
        .replace(/\b(Room\s+)?([a-z0-9-]{6,})\b/gi, (match, prefix: string | undefined, id: string) => {
          const roomNo = roomNoById.get(id);
          return roomNo ? `Room ${roomNo}` : match;
        });
    const deskItems = activityRaw.map((a) => {
      const tag = String(a.message ?? "").match(/^\[([A-Z_]+)\]/)?.[1] ?? "";
      return {
        id: `desk-${a.id}`,
        message: tidy(String(a.message ?? "")),
        at: String(a.createdAt ?? ""),
        type: ACTIVITY_TYPES[tag] ?? ("maintenance" as const),
      };
    });
    const paymentItems = ((txns.data ?? []) as Row[])
      .filter((t) => String(t.status) === "COMPLETED")
      .map((t) => {
        const refund = String(t.transaction_type) === "REFUND";
        const module = String(t.source_module ?? "") === "FNB" ? "F&B" : "Front Office";
        const method = String(t.payment_method ?? "").replace(/_/g, " ").toLowerCase();
        return {
          id: `txn-${t.id}`,
          message: `${refund ? "Refund issued" : "Payment received"} — ${inr(Number(t.amount ?? 0))} via ${method} (${module})`,
          at: String(t.created_at ?? ""),
          type: "payment" as const,
        };
      });
    const activity = [...deskItems, ...paymentItems]
      .filter((a) => a.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 8)
      .map(({ at, ...a }) => ({ ...a, timestamp: relativeTime(at, now) }));

    return ok(res, { summary, guests, revenue, bookingsChart, platform, ratings, activity, generatedAt: new Date(now).toISOString() });
  } catch (e) {
    return fromError(res, e);
  }
}

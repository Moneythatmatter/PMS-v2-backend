import type { Request, Response } from "express";
import { foModel } from "../../models/front-office/index.js";
import { reservationDisplayNo } from "../../services/front-office/reservation-lookup.js";
import { enrichReservations } from "../../services/front-office/reservation-enrich.js";
import {
  buildActiveBookingByRoomNo,
  deriveFoRoomStatus,
  fetchHkStatusByRoomIds,
} from "../../services/front-office/room-hk-status.js";
import { supabase } from "../../utils/supabase.js";
import { todayIso } from "../../utils/date.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Reservation = Record<string, unknown>;
type Room = Record<string, unknown>;
type Payment = Record<string, unknown>;
type Charge = Record<string, unknown>;

const TAX_GROUPS: Record<string, { label: string; group: string; sac: string }> = {
  ROOM: { label: "Room charges", group: "Rooms", sac: "996311" },
  FB: { label: "Food & beverage", group: "F&B", sac: "996331" },
  FNB: { label: "Food & beverage", group: "F&B", sac: "996331" },
  RESTAURANT: { label: "Restaurant", group: "F&B", sac: "996331" },
  ROOM_SERVICE: { label: "Room service", group: "F&B", sac: "996331" },
  LAUNDRY: { label: "Laundry", group: "Services", sac: "999712" },
};

function taxGroupOf(category: string) {
  const key = category.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "");
  return (
    TAX_GROUPS[key] ?? {
      label: key
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()) || "Other",
      group: "Services",
      sac: "—",
    }
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day (YYYY-MM-DD) of a stored date or timestamp, or "" when unparseable. */
function dayOf(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.length <= 10) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : todayIso(parsed);
}

/** Inclusive list of calendar days from `from` to `to` (YYYY-MM-DD). */
function daysBetween(from: string, to: string): string[] {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return from ? [from] : [];
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && days.length < 1000) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function queryDay(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  return ISO_DAY.test(raw) ? raw : fallback;
}

export async function getReport(req: Request, res: Response) {
  try {
    const type = String(req.params.type);
    if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) {
      return fail(res, `Unknown report type: ${type}`, 404);
    }

    const today = todayIso();
    let from = queryDay(req.query.from, today);
    let to = queryDay(req.query.to, from);
    if (from > to) [from, to] = [to, from];
    const inRange = (value: unknown) => {
      const day = dayOf(value);
      return day !== "" && day >= from && day <= to;
    };
    /** Stay touches the period: arrives on/before `to` and leaves on/after `from`. */
    const stayOverlaps = (r: Reservation) => {
      const inDay = dayOf(r.checkIn);
      const outDay = dayOf(r.checkOut) || inDay;
      return inDay !== "" && inDay <= to && outDay >= from;
    };

    const [reservationsRaw, rooms, paymentsRaw, shiftsRaw, chargesRaw] = await Promise.all([
      foModel.list<Reservation>(foModel.tables.reservations),
      foModel.list<Room>(foModel.tables.rooms),
      foModel.list<Payment>(foModel.tables.payments),
      type === "cashier"
        ? foModel.list(foModel.tables.cashierSessions, { orderBy: "opened_at", ascending: false })
        : Promise.resolve([]),
      type === "tax" || type === "revenue"
        ? foModel.list<Charge>(foModel.tables.folioCharges)
        : Promise.resolve([] as Charge[]),
    ]);
    const charges = chargesRaw.filter((c) =>
      inRange(c.businessDate ?? c.business_date ?? c.createdAt ?? c.created_at),
    );
    const allReservations = await enrichReservations(
      reservationsRaw as unknown as import("../../types/front-office.js").Reservation[],
    );
    const reservations = (allReservations as unknown as Reservation[]).filter(
      stayOverlaps,
    );
    const payments = paymentsRaw.filter((p) =>
      inRange(p.date ?? p.paymentDate ?? p.createdAt),
    );
    const shifts = (shiftsRaw as Record<string, unknown>[]).filter((s) =>
      inRange(s.openedAt ?? s.createdAt ?? s.date),
    );


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

    const periodDays = daysBetween(from, to);
    const roomTypeByNo = new Map(
      rooms.map((r) => [String(r.roomNo ?? ""), String(r.roomType ?? "")]),
    );
    const sellable = (r: Reservation) =>
      r.status !== "Cancelled" && r.status !== "No Show";

    /** Nights of a stay that fall inside the period (a same-day stay counts as one night). */
    const nightsInPeriod = (r: Reservation) => {
      const inDay = dayOf(r.checkIn);
      const outDay = dayOf(r.checkOut) || inDay;
      if (!inDay) return 0;
      if (outDay <= inDay) return inDay >= from && inDay <= to ? 1 : 0;
      return periodDays.filter((d) => d >= inDay && d < outDay).length;
    };
    const stayNights = (r: Reservation) => {
      const inDay = dayOf(r.checkIn);
      const outDay = dayOf(r.checkOut) || inDay;
      return Math.max(1, daysBetween(inDay, outDay).length - 1);
    };

    const occupancyByRoomType = () => {
      const groups = new Map<
        string,
        { roomType: string; rooms: number; sold: number; revenue: number }
      >();
      const group = (name: string) => {
        const key = name || "Unassigned";
        let g = groups.get(key);
        if (!g) {
          g = { roomType: key, rooms: 0, sold: 0, revenue: 0 };
          groups.set(key, g);
        }
        return g;
      };
      for (const room of rooms) {
        if (room.isActive === false) continue;
        group(String(room.roomType ?? "")).rooms += 1;
      }
      for (const r of reservations) {
        if (!sellable(r)) continue;
        const nights = nightsInPeriod(r);
        if (!nights) continue;
        const name =
          String(r.roomType ?? "") || roomTypeByNo.get(String(r.roomNo ?? "")) || "";
        const g = group(name);
        g.sold += nights;
        g.revenue += (Number(r.totalAmount ?? 0) / stayNights(r)) * nights;
      }
      return [...groups.values()]
        .sort((a, b) => a.roomType.localeCompare(b.roomType))
        .map((g) => {
          const available = g.rooms * periodDays.length;
          const occupancy = available ? Math.round((g.sold / available) * 100) : 0;
          return {
            id: g.roomType,
            roomType: g.roomType,
            totalRooms: available,
            occupied: g.sold,
            vacant: Math.max(0, available - g.sold),
            occupancy,
            adr: g.sold ? Math.round(g.revenue / g.sold) : 0,
            band: occupancy > 70 ? "High" : occupancy >= 40 ? "Medium" : "Low",
          };
        });
    };

    /** Posted folio charges in the period, one row per category and tax rate. */
    const taxRows = (() => {
      const groups = new Map<
        string,
        {
          category: string;
          sac: string;
          group: string;
          rate: number;
          taxable: number;
          cgst: number;
          sgst: number;
          igst: number;
          other: number;
          count: number;
        }
      >();
      for (const c of charges) {
        const details = (Array.isArray(c.taxDetails ?? c.tax_details)
          ? (c.taxDetails ?? c.tax_details)
          : []) as Record<string, unknown>[];
        const taxAmount = Number(c.taxAmount ?? c.tax_amount ?? 0);
        const rate = details.reduce((n, d) => n + Number(d.rate ?? 0), 0);
        const meta = taxGroupOf(String(c.chargeCategory ?? c.charge_category ?? "OTHER"));
        const key = `${meta.label}|${rate}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            category: rate ? `${meta.label} @ ${rate}%` : meta.label,
            sac: meta.sac,
            group: meta.group,
            rate,
            taxable: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            other: 0,
            count: 0,
          };
          groups.set(key, g);
        }
        g.count += 1;
        g.taxable += Number(c.amount ?? 0);
        let split = 0;
        for (const d of details) {
          const kind = String(d.taxType ?? d.taxCode ?? "").toUpperCase();
          const amount = Number(d.amount ?? 0);
          split += amount;
          if (kind.includes("CGST")) g.cgst += amount;
          else if (kind.includes("SGST") || kind.includes("UTGST")) g.sgst += amount;
          else if (kind.includes("IGST")) g.igst += amount;
          else g.other += amount;
        }
        if (taxAmount > split) g.other += taxAmount - split;
      }
      return [...groups.values()]
        .sort((a, b) => a.group.localeCompare(b.group) || a.rate - b.rate)
        .map((g) => ({
          id: `${g.category}`,
          category: g.category,
          sac: g.sac,
          charges: g.count,
          taxable: round2(g.taxable),
          cgst: round2(g.cgst),
          sgst: round2(g.sgst),
          igst: round2(g.igst),
          totalTax: round2(g.cgst + g.sgst + g.igst + g.other),
          group: g.group,
        }));
    })();

    /** Folio charges in the period by revenue category (amounts before tax). */
    const revenueRows = () => {
      const groups = new Map<string, { category: string; department: string; group: string; count: number; amount: number; tax: number }>();
      for (const c of charges) {
        const meta = taxGroupOf(String(c.chargeCategory ?? c.charge_category ?? "OTHER"));
        let g = groups.get(meta.label);
        if (!g) {
          g = {
            category: meta.label,
            department: meta.group === "Rooms" ? "Front Office" : meta.group === "F&B" ? "Food & Beverages" : "Services",
            group: meta.group === "Rooms" ? "Rooms" : meta.group === "F&B" ? "F&B" : "Other",
            count: 0,
            amount: 0,
            tax: 0,
          };
          groups.set(meta.label, g);
        }
        g.count += 1;
        g.amount += Number(c.amount ?? 0);
        g.tax += Number(c.taxAmount ?? c.tax_amount ?? 0);
      }
      const total = [...groups.values()].reduce((n, g) => n + g.amount, 0);
      return [...groups.values()]
        .sort((a, b) => b.amount - a.amount)
        .map((g) => ({
          id: g.category,
          category: g.category,
          department: g.department,
          transactions: g.count,
          amount: round2(g.amount),
          tax: round2(g.tax),
          gross: round2(g.amount + g.tax),
          share: total ? Math.round((g.amount / total) * 100) : 0,
          group: g.group,
        }));
    };

    /** Cashier sessions opened in the period with collections from their tagged transactions. */
    const cashierRows = async () => {
      const ids = shifts.map((s) => String(s.id));
      if (!ids.length) return [];
      const [txns, users] = await Promise.all([
        supabase
          .from("transactions")
          .select("cashier_session_id, payment_method, transaction_type, status, amount")
          .in("cashier_session_id", ids),
        supabase
          .from("users")
          .select("id, name, email")
          .in("id", [...new Set(shifts.map((s) => String(s.cashierId ?? "")))]),
      ]);
      const names = new Map(
        ((users.data ?? []) as Record<string, unknown>[]).map((u) => [
          String(u.id),
          String(u.name || u.email || "Unknown user"),
        ]),
      );
      const totals = new Map<string, { collected: number; cash: number; refunds: number; paidOut: number }>();
      for (const t of (txns.data ?? []) as Record<string, unknown>[]) {
        const status = String(t.status ?? "");
        if (status === "FAILED" || status === "VOIDED" || status === "PENDING") continue;
        const key = String(t.cashier_session_id);
        const bucket = totals.get(key) ?? { collected: 0, cash: 0, refunds: 0, paidOut: 0 };
        const amount = Number(t.amount ?? 0);
        const kind = String(t.transaction_type ?? "PAYMENT");
        const isCash = /CASH/i.test(String(t.payment_method ?? ""));
        if (kind === "REFUND" || status === "REFUNDED") bucket.refunds += amount;
        else if (kind === "ADJUSTMENT") bucket.paidOut += amount;
        else if (status === "COMPLETED") {
          bucket.collected += amount;
          if (isCash) bucket.cash += amount;
        }
        totals.set(key, bucket);
      }
      return shifts.map((s) => {
        const t = totals.get(String(s.id)) ?? { collected: 0, cash: 0, refunds: 0, paidOut: 0 };
        const opening = Number(s.openingCash ?? 0);
        const shiftName = String(s.shiftName ?? "—");
        return {
          id: String(s.id),
          cashier: names.get(String(s.cashierId ?? "")) ?? "Unknown cashier",
          shift: shiftName,
          shiftBand: /morning/i.test(shiftName) ? "Morning" : /evening|afternoon/i.test(shiftName) ? "Evening" : /night/i.test(shiftName) ? "Night" : shiftName,
          openedAt: s.openedAt ? new Date(String(s.openedAt)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—",
          openingFloat: round2(opening),
          collected: round2(t.collected),
          refunds: round2(t.refunds),
          closing: round2(opening + t.cash - t.refunds - t.paidOut),
          status: String(s.status ?? "—"),
        };
      });
    };

    /** Guests with stays touching the period: stay count, latest arrival and room revenue. */
    const guestRows = () => {
      const groups = new Map<string, { r: Reservation; stays: number; lastStay: string; revenue: number; corporate: boolean }>();
      for (const r of reservations) {
        if (r.status === "Cancelled") continue;
        const key = String(r.guestId ?? "") || `${String(r.guestName ?? "").toLowerCase()}|${String(r.phone ?? "")}`;
        const g = groups.get(key) ?? { r, stays: 0, lastStay: "", revenue: 0, corporate: false };
        g.stays += 1;
        g.revenue += Number(r.totalAmount ?? 0);
        const inDay = dayOf(r.checkIn);
        if (inDay > g.lastStay) {
          g.lastStay = inDay;
          g.r = r;
        }
        if (r.companyId || r.company || r.companyName) g.corporate = true;
        groups.set(key, g);
      }
      return [...groups.entries()].map(([key, g]) => {
        const nationality = String(g.r.nationality ?? "").trim();
        const segment = g.corporate
          ? "Corporate"
          : !nationality || /^(india|indian|in)$/i.test(nationality)
            ? "Indian"
            : "International";
        return {
          id: key,
          guestName: String(g.r.guestName ?? "—"),
          phone: String(g.r.phone ?? ""),
          nationality: nationality || "Indian",
          segment,
          totalStays: g.stays,
          lastStay: g.lastStay || "—",
          revenue: round2(g.revenue),
          status: String(g.r.status ?? "—"),
        };
      });
    };

    /** Current status of every room: today's guest, housekeeping state and departure. */
    const roomRows = async () => {
      const hkByRoomId = await fetchHkStatusByRoomIds(rooms.map((r) => String(r.id)));
      const bookingByRoom = buildActiveBookingByRoomNo(
        allReservations as unknown as Parameters<typeof buildActiveBookingByRoomNo>[0],
      ) as Map<string, Reservation>;
      return rooms
        .slice()
        .sort((a, b) => String(a.roomNo ?? "").localeCompare(String(b.roomNo ?? ""), undefined, { numeric: true }))
        .map((room) => {
          const roomNo = String(room.roomNo ?? "");
          const hk = hkByRoomId.get(String(room.id)) ?? "DIRTY";
          const booking = bookingByRoom.get(roomNo);
          return {
            id: String(room.id),
            roomNo,
            roomType: String(room.roomType ?? "—"),
            floor: String(room.floor ?? "—"),
            guestName: booking ? String(booking.guestName ?? "—") : "—",
            housekeeping: hk
              .toLowerCase()
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
            checkoutDate: booking ? dayOf(booking.checkOut) || "—" : "—",
            status: deriveFoRoomStatus(hk, booking, room.isActive !== false),
          };
        });
    };

    const rows = await (async () => {
      switch (type) {
        case "arrival":
          return reservations
            .filter(
              (r) =>
                inRange(r.checkIn) &&
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
            .filter(
              (r) =>
                inRange(r.checkOut) &&
                (r.status === "Checked In" || r.status === "Checked Out"),
            )
            .map((r) => ({
              bookingId: reservationDisplayNo(r),
              guest: r.guestName,
              room: r.roomNo,
              checkOut: r.checkOut,
              balance: r.balance,
              status: r.status,
            }));
        case "occupancy":
          return occupancyByRoomType();
        case "revenue":
          return revenueRows();
        case "cashier":
          return cashierRows();
        case "guest":
          return guestRows();
        case "room":
          return roomRows();
        case "tax":
          return taxRows;
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

    const soldNights = reservations
      .filter(sellable)
      .reduce((n, r) => n + nightsInPeriod(r), 0);
    const availableNights =
      rooms.filter((r) => r.isActive !== false).length * periodDays.length;
    const taxSummary = {
      taxableTotal: round2(taxRows.reduce((n, r) => n + r.taxable, 0)),
      cgstTotal: round2(taxRows.reduce((n, r) => n + r.cgst, 0)),
      sgstTotal: round2(taxRows.reduce((n, r) => n + r.sgst, 0)),
      taxTotal: round2(taxRows.reduce((n, r) => n + r.totalTax, 0)),
    };
    const summary = type === "tax" ? taxSummary : {
      occupancy: availableNights
        ? Math.round((soldNights / availableNights) * 100)
        : 0,
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
      from,
      to,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

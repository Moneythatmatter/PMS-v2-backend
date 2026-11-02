import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { TransactionService } from "../shared/transaction.service.js";
import { ReservationStatus } from "../../constants/front-office.js";
import type { Reservation } from "../../types/front-office.js";
import { addDays, currentBusinessDate, isoDay } from "./business-date.js";
import { localTodayIso } from "./room-hk-status.js";
import {
  loadTaxSetup,
  quoteTax,
  resolveBillingPoint,
  type TaxQuote,
  type TaxRuleset,
} from "../accounts/tax-resolver.js";

type Row = Record<string, unknown>;

export const BillingMode = {
  LEGACY_SEEDED: "LEGACY_SEEDED",
  NIGHTLY: "NIGHTLY",
} as const;

/** Guards against runaway catch-up when a stay has bad dates. */
const MAX_NIGHTS_PER_POSTING = 62;

/** Room tax rules for the FO_ROOM_NIGHT billing point; issues block every posting. */
export type RoomTaxConfig = TaxRuleset & { priceIncludesTax?: boolean };

export type RoomTaxQuote = TaxQuote;

export type RoomNightPosting = {
  reservationId: string;
  night: string;
  amount: number;
  tax: number;
  posted: boolean;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roomNightSourceId(reservationId: string, night: string) {
  return `${reservationId}:${night}`;
}

export function isNightlyBilled(r: Pick<Reservation, "groupId"> & { billingMode?: unknown }) {
  return r.billingMode === BillingMode.NIGHTLY && !r.groupId;
}

/** Per-night tariff before tax. */
export function nightlyTariff(r: Reservation): number {
  const rate = num(r.roomRate);
  if (rate > 0) return round2(rate);
  const nights = Math.max(1, num(r.nights));
  return round2(num(r.totalAmount) / nights);
}

/** Every night from the stay start through `lastNight` (inclusive). */
export function nightsThrough(r: Reservation, lastNight: string): string[] {
  const checkIn = isoDay(r.checkIn);
  const start = checkIn && checkIn <= lastNight ? checkIn : lastNight;
  const nights: string[] = [];
  for (let d = start; d <= lastNight && nights.length < MAX_NIGHTS_PER_POSTING; d = addDays(d, 1)) {
    nights.push(d);
  }
  return nights;
}

export async function loadRoomTaxConfig(date: string = localTodayIso()): Promise<RoomTaxConfig> {
  const resolution = resolveBillingPoint(await loadTaxSetup(), "FO_ROOM_NIGHT", date);
  if (!resolution.configured) {
    return { issues: ["Accounts → Tax/GST Master → Billing Points: room charge is not mapped"], rules: [], taxes: new Map() };
  }
  return { ...resolution.ruleset, priceIncludesTax: resolution.priceIncludesTax };
}

export function quoteRoomTax(config: RoomTaxConfig, tariff: number, night: string): RoomTaxQuote {
  return quoteTax(config, tariff, night, { priceIncludesTax: config.priceIncludesTax });
}

/** Nights already charged, keyed by reservation id. */
export async function postedNightsByReservation(reservationIds: string[]) {
  const map = new Map<string, Set<string>>();
  if (!reservationIds.length) return map;
  const { data, error } = await supabase
    .from("folio_charges")
    .select("reservation_id, source_id")
    .eq("source_module", "FRONT_OFFICE")
    .eq("source_type", "ROOM_NIGHT")
    .in("reservation_id", reservationIds);
  if (error) throw new AppError(error.message, 500);
  for (const row of (data ?? []) as Row[]) {
    const id = String(row.reservation_id ?? "");
    const night = String(row.source_id ?? "").split(":").pop() ?? "";
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(night);
  }
  return map;
}

async function postNight(
  r: Reservation,
  folioId: string,
  night: string,
  quote: Extract<RoomTaxQuote, { ok: true }>,
): Promise<boolean> {
  const roomLabel = String((r as { roomNo?: string }).roomNo ?? "").trim();
  const { data, error } = await supabase.rpc("fo_post_room_night", {
    p_reservation_id: r.id,
    p_folio_id: folioId,
    p_property_id: getActivePropertyId() ?? null,
    p_guest_id: r.guestId ?? null,
    p_business_date: night,
    p_amount: quote.taxableAmount,
    p_tax_amount: quote.taxAmount,
    p_tax_details: quote.lines,
    p_description: `Room charge — ${night}${roomLabel ? ` · Room ${roomLabel}` : ""}`,
    p_created_by: getRequestStore()?.userId ?? null,
  });
  if (error) throw new AppError(`Room night ${night}: ${error.message}`, 500);
  return Boolean((data as { posted?: boolean } | null)?.posted);
}

export const RoomNightService = {
  /**
   * Post every unposted night of a nightly-billed stay through `lastNight`.
   * Safe to repeat: each night is keyed by reservation + date in the database.
   */
  async postThrough(
    r: Reservation,
    lastNight: string,
    config?: RoomTaxConfig,
  ): Promise<RoomNightPosting[]> {
    if (!isNightlyBilled(r)) return [];
    const tariff = nightlyTariff(r);
    if (!(tariff > 0)) return [];

    const nights = nightsThrough(r, lastNight);
    const posted = (await postedNightsByReservation([r.id])).get(r.id) ?? new Set<string>();
    const pending = nights.filter((n) => !posted.has(n));
    if (!pending.length) return [];

    const taxConfig = config ?? (await loadRoomTaxConfig(lastNight));
    const quotes = pending.map((night) => ({ night, quote: quoteRoomTax(taxConfig, tariff, night) }));
    const blocked = quotes.find((q) => !q.quote.ok);
    if (blocked && !blocked.quote.ok) {
      throw new AppError(`Room tax setup incomplete — ${blocked.quote.issue}`, 409);
    }

    const folioId = await TransactionService.ensureFolioForBooking(r.id, r.guestId ?? null);
    const results: RoomNightPosting[] = [];
    for (const { night, quote } of quotes) {
      if (!quote.ok) continue;
      const didPost = await postNight(r, folioId, night, quote);
      results.push({ reservationId: r.id, night, amount: quote.taxableAmount, tax: quote.taxAmount, posted: didPost });
    }
    return results;
  },

  /**
   * Nights owed when an in-house guest leaves: everything up to the night before
   * departure, and at least the arrival night for same-day departures.
   */
  async postForCheckout(r: Reservation): Promise<RoomNightPosting[]> {
    if (!isNightlyBilled(r)) return [];
    if (r.status !== ReservationStatus.CHECKED_IN && r.status !== ReservationStatus.IN_HOUSE) return [];
    const { businessDate } = await currentBusinessDate();
    const today = localTodayIso();
    const departure = businessDate > today ? businessDate : today;
    const checkIn = isoDay(r.checkIn) || departure;
    const lastNight = addDays(departure, -1) >= checkIn ? addDays(departure, -1) : checkIn;
    return this.postThrough(r, lastNight);
  },
};

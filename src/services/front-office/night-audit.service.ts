import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { ReservationStatus } from "../../constants/front-office.js";
import type { Reservation } from "../../types/front-office.js";
import { enrichReservations } from "./reservation-enrich.js";
import { FoPostingService } from "../accounts/fo-posting.service.js";
import { FbPostingService } from "../accounts/fb-posting.service.js";
import { localTodayIso } from "./room-hk-status.js";
import {
  NIGHT_AUDITS_TABLE,
  addDays,
  currentBusinessDate,
  isMissingTableError,
} from "./business-date.js";
import {
  BillingMode,
  RoomNightService,
  isNightlyBilled,
  loadRoomTaxConfig,
  nightlyTariff,
  nightsThrough,
  postedNightsByReservation,
  quoteRoomTax,
  type RoomNightPosting,
} from "./room-night.service.js";

type Row = Record<string, unknown>;

/** A RUNNING row older than this is treated as a crashed run and may be retried. */
const STALE_RUN_MS = 10 * 60 * 1000;

export type NightAuditPreviewRow = {
  reservationId: string;
  bookingNo: string;
  guestName: string;
  roomNo: string;
  tariff: number;
  nights: string[];
  amount: number;
  tax: number;
  issue: string | null;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function isInHouse(r: Reservation) {
  return r.status === ReservationStatus.CHECKED_IN || r.status === ReservationStatus.IN_HOUSE;
}

async function userName(userId: string) {
  if (!userId) return "Unknown user";
  const { data } = await supabase.from("users").select("name, email").eq("id", userId).maybeSingle();
  const u = data as { name?: string | null; email?: string | null } | null;
  return u?.name || u?.email || "Unknown user";
}

async function auditFor(businessDate: string): Promise<{ row: Row | null; tableReady: boolean }> {
  const { data, error } = await supabase
    .from(NIGHT_AUDITS_TABLE)
    .select("*")
    .eq("property_id", getActivePropertyId()!)
    .eq("business_date", businessDate)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.message)) return { row: null, tableReady: false };
    throw new AppError(error.message, 500);
  }
  return { row: (data as Row | null) ?? null, tableReady: true };
}

async function updateAudit(id: string, patch: Row) {
  const { data, error } = await supabase
    .from(NIGHT_AUDITS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new AppError(error.message, 500);
  return data as Row;
}

export type NightAuditAccountsResult = {
  status: "POSTED" | "NOTHING" | "FAILED";
  voucherId?: string;
  voucherNo?: string;
  voucherStatus?: string;
  amount?: number;
  message?: string;
};

/** Post the day's folio charges and payments to Accounts (see Accounts → Front Office Posting). */
async function postToAccounts(businessDate: string, cutoff: string): Promise<NightAuditAccountsResult> {
  try {
    const res = await FoPostingService.post(businessDate, { cutoff, trigger: "NIGHT_AUDIT" });
    if (!res.voucher) return { status: "NOTHING", message: "Nothing new to post to Accounts" };
    return {
      status: "POSTED",
      voucherId: res.voucher.id,
      voucherNo: res.voucher.voucherNo,
      voucherStatus: res.voucher.status,
      amount: Number(res.voucher.totalAmount ?? 0),
    };
  } catch (e) {
    return {
      status: "FAILED",
      message: `${errorMessage(e)} — fix it, then use Accounts → Front Office Posting to post ${businessDate}.`,
    };
  }
}

/** Post the day's settled restaurant / bar bills to Accounts (see Accounts → F&B Posting). */
async function postFnbToAccounts(businessDate: string): Promise<NightAuditAccountsResult> {
  try {
    const res = await FbPostingService.post(businessDate, { trigger: "NIGHT_AUDIT" });
    if (!res.voucher) return { status: "NOTHING", message: "No new F&B bills to post to Accounts" };
    return {
      status: "POSTED",
      voucherId: res.voucher.id,
      voucherNo: res.voucher.voucherNo,
      voucherStatus: res.voucher.status,
      amount: Number(res.voucher.totalAmount ?? 0),
    };
  } catch (e) {
    return {
      status: "FAILED",
      message: `${errorMessage(e)} — fix it, then use Accounts → F&B Posting to post ${businessDate}.`,
    };
  }
}

/** Take the per-property/date lock: insert a RUNNING row, or re-claim a FAILED / stale one. */
async function claimRun(businessDate: string, existing: Row | null, dayClosingId: string) {
  const userId = String(getRequestStore()?.userId ?? "");
  const runBy = { run_by: userId || null, run_by_name: await userName(userId) };
  const now = new Date().toISOString();

  if (!existing) {
    const { data, error } = await supabase
      .from(NIGHT_AUDITS_TABLE)
      .insert({
        property_id: getActivePropertyId(),
        business_date: businessDate,
        next_business_date: addDays(businessDate, 1),
        status: "RUNNING",
        day_closing_id: dayClosingId,
        started_at: now,
        ...runBy,
      })
      .select()
      .single();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new AppError("Night audit is already running for this date", 409);
      }
      throw new AppError(error.message, 500);
    }
    return data as Row;
  }

  const status = String(existing.status);
  if (status === "COMPLETED") throw new AppError("Night audit is already completed for this date", 409);
  const startedAt = Date.parse(String(existing.started_at ?? ""));
  if (status === "RUNNING" && Number.isFinite(startedAt) && Date.now() - startedAt < STALE_RUN_MS) {
    throw new AppError("Night audit is already running for this date", 409);
  }

  const { data, error } = await supabase
    .from(NIGHT_AUDITS_TABLE)
    .update({
      status: "RUNNING",
      error: null,
      started_at: now,
      day_closing_id: dayClosingId,
      attempts: Number(existing.attempts ?? 1) + 1,
      updated_at: now,
      ...runBy,
    })
    .eq("id", String(existing.id))
    .eq("status", status)
    .eq("started_at", String(existing.started_at))
    .select();
  if (error) throw new AppError(error.message, 500);
  if (!data?.length) throw new AppError("Night audit is already running for this date", 409);
  return data[0] as Row;
}

export const NightAuditService = {
  async status() {
    if (!getActivePropertyId()) throw new AppError("Select a property first");
    const { businessDate, lastAudit } = await currentBusinessDate();
    const calendarDate = localTodayIso();

    const [closings, auditState, reservationsRaw] = await Promise.all([
      foModel.list<Row>(foModel.tables.dayClosings, { filters: { business_date: businessDate }, limit: 1 }),
      auditFor(businessDate),
      foModel.list<Reservation>(foModel.tables.reservations),
    ]);
    const dayClosing = closings[0] ?? null;
    const audit = auditState.row;

    const inHouse = (await enrichReservations(reservationsRaw)).filter(isInHouse);
    const nightly = inHouse.filter(isNightlyBilled);
    const groupCount = inHouse.filter((r) => r.groupId).length;
    const legacyCount = inHouse.filter(
      (r) => !r.groupId && r.billingMode !== BillingMode.NIGHTLY,
    ).length;

    const blockers: { id: string; message: string; href?: string }[] = [];
    if (!auditState.tableReady) {
      blockers.push({
        id: "setup",
        message: "Night audit tables are missing — run backend/sql/fo-night-audit-phase1.sql in Supabase.",
      });
    }
    if (!dayClosing) {
      blockers.push({
        id: "day-closing",
        message: `Run Day Closing for ${businessDate} first.`,
        href: "/frontoffice/day-closing",
      });
    }
    if (audit?.status === "COMPLETED") {
      blockers.push({ id: "done", message: `Night audit for ${businessDate} is already completed.` });
    }

    const rows: NightAuditPreviewRow[] = [];
    const taxIssues = new Set<string>();
    if (nightly.length && auditState.tableReady) {
      const [config, posted] = await Promise.all([
        loadRoomTaxConfig(businessDate),
        postedNightsByReservation(nightly.map((r) => r.id)),
      ]);
      for (const r of nightly) {
        const tariff = nightlyTariff(r);
        const done = posted.get(r.id) ?? new Set<string>();
        const nights = tariff > 0 ? nightsThrough(r, businessDate).filter((n) => !done.has(n)) : [];
        let tax = 0;
        let amount = 0;
        let issue: string | null = null;
        for (const night of nights) {
          const quote = quoteRoomTax(config, tariff, night);
          if (!quote.ok) {
            issue = quote.issue;
            taxIssues.add(quote.issue);
            break;
          }
          tax += quote.taxAmount;
          amount += quote.taxableAmount;
        }
        rows.push({
          reservationId: r.id,
          bookingNo: String(r.bookingNo ?? r.id),
          guestName: String(r.guestName ?? "Guest"),
          roomNo: String(r.roomNo ?? ""),
          tariff,
          nights,
          amount: round2(issue ? tariff * nights.length : amount),
          tax: round2(tax),
          issue,
        });
      }
    }
    for (const issue of taxIssues) {
      blockers.push({ id: "tax", message: `Room tax setup incomplete — ${issue}`, href: "/accounts" });
    }

    return {
      businessDate,
      nextBusinessDate: addDays(businessDate, 1),
      calendarDate,
      dayClosing,
      audit: audit ? toCamel<Row>(audit) : null,
      lastAudit: lastAudit ? toCamel<Row>(lastAudit) : null,
      canRun: blockers.length === 0,
      blockers,
      inHouse: inHouse.length,
      legacyCount,
      groupCount,
      preview: {
        rows,
        nights: rows.reduce((s, r) => s + r.nights.length, 0),
        amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
        tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
      },
    };
  },

  /**
   * Post tonight's room charges, then advance the business date.
   * Any failure leaves the date where it was; already-posted nights are skipped on retry.
   */
  async run() {
    const status = await this.status();
    if (!status.canRun) {
      throw new AppError(status.blockers.map((b) => b.message).join(" "), 409);
    }
    const businessDate = status.businessDate;
    const { row: existing } = await auditFor(businessDate);
    const claimed = await claimRun(businessDate, existing, String(status.dayClosing?.id ?? ""));
    const auditId = String(claimed.id);

    const reservations = (await enrichReservations(
      await foModel.list<Reservation>(foModel.tables.reservations),
    )).filter((r) => isInHouse(r) && isNightlyBilled(r));

    const postings: RoomNightPosting[] = [];
    const failures: { reservationId: string; bookingNo: string; error: string }[] = [];
    try {
      const config = await loadRoomTaxConfig(businessDate);
      for (const r of reservations) {
        try {
          postings.push(...(await RoomNightService.postThrough(r, businessDate, config)));
        } catch (e) {
          failures.push({
            reservationId: r.id,
            bookingNo: String(r.bookingNo ?? r.id),
            error: errorMessage(e),
          });
        }
      }
    } catch (e) {
      failures.push({ reservationId: "", bookingNo: "", error: errorMessage(e) });
    }

    const newlyPosted = postings.filter((p) => p.posted);
    const totals = {
      roomNightsPosted: newlyPosted.length,
      roomRevenue: round2(newlyPosted.reduce((s, p) => s + p.amount, 0)),
      roomTax: round2(newlyPosted.reduce((s, p) => s + p.tax, 0)),
    };
    const summary = {
      ...totals,
      inHouse: status.inHouse,
      nightlyStays: reservations.length,
      legacyStays: status.legacyCount,
      groupStays: status.groupCount,
      postings,
      failures,
    };

    if (failures.length) {
      await updateAudit(auditId, {
        status: "FAILED",
        error: failures.map((f) => (f.bookingNo ? `${f.bookingNo}: ${f.error}` : f.error)).join("\n"),
        room_nights_posted: totals.roomNightsPosted,
        room_revenue: totals.roomRevenue,
        room_tax: totals.roomTax,
        summary,
      });
      throw new AppError(
        `Night audit failed — business date stays ${businessDate}. ${failures.length} stay(s) could not be posted: ${failures
          .map((f) => (f.bookingNo ? `${f.bookingNo} (${f.error})` : f.error))
          .join("; ")}`,
        409,
      );
    }

    const completedAt = new Date().toISOString();
    const done = await updateAudit(auditId, {
      status: "COMPLETED",
      error: null,
      next_business_date: addDays(businessDate, 1),
      completed_at: completedAt,
      room_nights_posted: totals.roomNightsPosted,
      room_revenue: totals.roomRevenue,
      room_tax: totals.roomTax,
      summary,
    });

    // The business date has moved on; an Accounts problem must not undo the audit.
    const accounts = await postToAccounts(businessDate, completedAt);
    const accountsFnb = await postFnbToAccounts(businessDate);
    const final = await updateAudit(auditId, { summary: { ...summary, accounts, accountsFnb } }).catch(() => done);
    return toCamel<Row>(final);
  },

  async history(limit = 30) {
    const propertyId = getActivePropertyId();
    if (!propertyId) throw new AppError("Select a property first");
    const { data, error } = await supabase
      .from(NIGHT_AUDITS_TABLE)
      .select("id, business_date, next_business_date, status, attempts, room_nights_posted, room_revenue, room_tax, error, run_by_name, started_at, completed_at, summary")
      .eq("property_id", propertyId)
      .order("business_date", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error.message)) return [];
      throw new AppError(error.message, 500);
    }
    return (data ?? []).map((r) => toCamel<Row>(r as Row));
  },
};

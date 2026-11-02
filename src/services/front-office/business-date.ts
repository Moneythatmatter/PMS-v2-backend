import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { localTodayIso } from "./room-hk-status.js";

type Row = Record<string, unknown>;

export const NIGHT_AUDITS_TABLE = "fo_night_audits";

export function isoDay(value: unknown) {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isMissingTableError(message: string) {
  return /fo_night_audits|schema cache|does not exist/i.test(message);
}

/** Latest completed audit for the active property; null when none or before fo-night-audit-phase1.sql. */
export async function lastCompletedAudit(): Promise<Row | null> {
  const propertyId = getActivePropertyId();
  if (!propertyId) return null;
  const { data, error } = await supabase
    .from(NIGHT_AUDITS_TABLE)
    .select("*")
    .eq("property_id", propertyId)
    .eq("status", "COMPLETED")
    .order("business_date", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new AppError(error.message, 500);
  }
  return (data?.[0] as Row | undefined) ?? null;
}

export async function lastDayClosing(): Promise<Row | null> {
  const rows = await foModel.list<Row>(foModel.tables.dayClosings, {
    orderBy: "created_at",
    ascending: false,
    limit: 1,
  });
  return rows[0] ?? null;
}

/**
 * Night Audit is the only step that advances the business date.
 * Before the first audit, the most recently closed day is still open for its audit.
 */
export async function currentBusinessDate() {
  const [audit, closing] = await Promise.all([lastCompletedAudit(), lastDayClosing()]);
  const fromAudit = isoDay(audit?.next_business_date);
  const businessDate = fromAudit || isoDay(closing?.businessDate) || localTodayIso();
  return { businessDate, lastAudit: audit, lastClosing: closing };
}

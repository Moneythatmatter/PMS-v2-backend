import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Reservation } from "../../types/front-office.js";

/** Load reservation by UUID id or display booking_no (e.g. BK-12). */
export async function getReservationByKey(
  key: string,
): Promise<Reservation | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await foModel.get<Reservation>(
    foModel.tables.reservations,
    trimmed,
  );
  if (byId) return byId;

  const propertyId = getActivePropertyId();
  let query = supabase
    .from(foModel.tables.reservations)
    .select("*")
    .eq("booking_no", trimmed);
  if (propertyId) query = query.eq("property_id", propertyId);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<Reservation>(data) : null;
}

export function reservationDisplayNo(row: Partial<Reservation>): string {
  return String(row.bookingNo ?? row.id ?? "").trim();
}

import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Guest } from "../../types/front-office.js";

/** Load guest by UUID id or display guest_no (e.g. G-12). */
export async function getGuestByKey(key: string): Promise<Guest | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await foModel.get<Guest>(foModel.tables.guests, trimmed);
  if (byId) return byId;

  const { data, error } = await supabase
    .from(foModel.tables.guests)
    .select("*")
    .eq("guest_no", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<Guest>(data) : null;
}

export function guestDisplayNo(row: Partial<Guest>): string {
  return String(row.guestNo ?? row.id ?? "").trim();
}

/** Strip auto-assigned guest_no from API writes. */
export function sanitizeGuestInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body = { ...input };
  delete body.guestNo;
  return body;
}

function normalizeMobile(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Reject create/update when mobile or email belongs to another guest profile. */
export async function assertGuestContactUnique(
  body: Record<string, unknown>,
  excludeGuestId?: string,
): Promise<void> {
  const mobile = normalizeMobile(body.mobile);
  const email = normalizeEmail(body.email);

  if (mobile.length >= 10) {
    const { data, error } = await supabase
      .from(foModel.tables.guests)
      .select("id, name, mobile")
      .not("mobile", "is", null);

    if (error) throw new Error(error.message);

    const mobileMatch = (data ?? []).find((row) => {
      if (excludeGuestId && String(row.id) === excludeGuestId) return false;
      const gm = normalizeMobile(row.mobile);
      return gm && (gm === mobile || gm.endsWith(mobile) || mobile.endsWith(gm));
    });

    if (mobileMatch) {
      throw new Error(
        `Mobile number already registered to ${mobileMatch.name ?? "another guest"}.`,
      );
    }
  }

  if (email) {
    let query = supabase
      .from(foModel.tables.guests)
      .select("id, name, email")
      .ilike("email", email);

    if (excludeGuestId) {
      query = query.neq("id", excludeGuestId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      throw new Error(
        `Email already registered to ${data.name ?? "another guest"}.`,
      );
    }
  }
}

import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId } from "../../utils/request-context.js";
/** Load guest by UUID id or display guest_no (e.g. G-12). */
export async function getGuestByKey(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await foModel.get(foModel.tables.guests, trimmed);
    if (byId)
        return byId;
    const { data, error } = await supabase
        .from(foModel.tables.guests)
        .select("*")
        .eq("guest_no", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? toCamel(data) : null;
}
export function guestDisplayNo(row) {
    return String(row.guestNo ?? row.id ?? "").trim();
}
/** Strip auto-assigned guest_no and computed fields from API writes. */
export function sanitizeGuestInput(input) {
    const body = { ...input };
    delete body.guestNo;
    delete body.totalStays;
    return body;
}
/** Count non-cancelled bookings per guest (property-scoped when active). */
export async function attachGuestStayCounts(guests) {
    if (guests.length === 0)
        return [];
    const guestIds = guests.map((g) => g.id);
    const propertyId = getActivePropertyId();
    let query = supabase
        .from(foModel.tables.reservations)
        .select("guest_id")
        .in("guest_id", guestIds)
        .neq("status", "Cancelled");
    if (propertyId) {
        query = query.eq("property_id", propertyId);
    }
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    const counts = new Map();
    for (const row of data ?? []) {
        const guestId = String(row.guest_id);
        counts.set(guestId, (counts.get(guestId) ?? 0) + 1);
    }
    return guests.map((guest) => ({
        ...guest,
        totalStays: counts.get(guest.id) ?? 0,
    }));
}
export async function attachGuestStayCount(guest) {
    const [enriched] = await attachGuestStayCounts([guest]);
    return enriched;
}
function normalizeMobile(value) {
    return String(value ?? "").replace(/\D/g, "");
}
function normalizeEmail(value) {
    return String(value ?? "").trim().toLowerCase();
}
/** Reject create/update when mobile or email belongs to another guest profile. */
export async function assertGuestContactUnique(body, excludeGuestId) {
    const mobile = normalizeMobile(body.mobile);
    const email = normalizeEmail(body.email);
    if (mobile.length >= 10) {
        const { data, error } = await supabase
            .from(foModel.tables.guests)
            .select("id, name, mobile")
            .not("mobile", "is", null);
        if (error)
            throw new Error(error.message);
        const mobileMatch = (data ?? []).find((row) => {
            if (excludeGuestId && String(row.id) === excludeGuestId)
                return false;
            const gm = normalizeMobile(row.mobile);
            return gm && (gm === mobile || gm.endsWith(mobile) || mobile.endsWith(gm));
        });
        if (mobileMatch) {
            throw new Error(`Mobile number already registered to ${mobileMatch.name ?? "another guest"}.`);
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
        if (error)
            throw new Error(error.message);
        if (data) {
            throw new Error(`Email already registered to ${data.name ?? "another guest"}.`);
        }
    }
}
//# sourceMappingURL=guest-lookup.js.map
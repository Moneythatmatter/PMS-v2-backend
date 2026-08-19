import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
/** Load reservation by UUID id or display booking_no (e.g. BK-12). */
export async function getReservationByKey(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await foModel.get(foModel.tables.reservations, trimmed);
    if (byId)
        return byId;
    const { data, error } = await supabase
        .from(foModel.tables.reservations)
        .select("*")
        .eq("booking_no", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? toCamel(data) : null;
}
export function reservationDisplayNo(row) {
    return String(row.bookingNo ?? row.id ?? "").trim();
}
//# sourceMappingURL=reservation-lookup.js.map
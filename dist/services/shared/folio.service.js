import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { enrichReservations } from "../front-office/reservation-enrich.js";
import { supabase } from "../../utils/supabase.js";
async function fetchReservationsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.reservations)
        .select("*")
        .in("id", unique);
    if (error)
        throw new Error(error.message);
    const enriched = await enrichReservations((data ?? []).map((row) => toCamel(row)));
    for (const row of enriched) {
        map.set(row.id, row);
    }
    return map;
}
async function fetchGuestsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.guests)
        .select("*")
        .in("id", unique);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const guest = toCamel(row);
        map.set(guest.id, guest);
    }
    return map;
}
function attachContext(folio, reservation, guest) {
    return {
        ...folio,
        guestName: reservation?.guestName ??
            guest?.name ??
            "Guest",
        guestNo: reservation?.guestNo ?? guest?.guestNo ?? null,
        room: reservation?.roomNo ?? null,
        roomType: reservation?.roomType ?? null,
        bookingNo: reservation?.bookingNo ?? null,
        checkIn: reservation?.checkIn ?? null,
        checkOut: reservation?.checkOut ?? null,
        reservationStatus: reservation?.status ?? null,
    };
}
export const FolioService = {
    async list(filters = {}) {
        const rows = await foModel.list(foModel.tables.folios, {
            filters: {
                booking_id: filters.bookingId,
                guest_id: filters.guestId,
                status: filters.status,
            },
            orderBy: "opened_at",
            ascending: false,
        });
        const bookingIds = rows
            .map((f) => f.bookingId)
            .filter((id) => Boolean(id?.trim()));
        const guestIds = rows
            .map((f) => f.guestId)
            .filter((id) => Boolean(id?.trim()));
        const [reservationMap, guestMap] = await Promise.all([
            fetchReservationsByIds(bookingIds),
            fetchGuestsByIds(guestIds),
        ]);
        return rows.map((folio) => {
            const reservation = folio.bookingId
                ? reservationMap.get(folio.bookingId)
                : undefined;
            const guest = folio.guestId ? guestMap.get(folio.guestId) : undefined;
            return attachContext(folio, reservation, guest);
        });
    },
    async getById(id) {
        const folio = await foModel.get(foModel.tables.folios, id);
        if (!folio)
            return null;
        const reservation = folio.bookingId
            ? (await fetchReservationsByIds([folio.bookingId])).get(folio.bookingId)
            : undefined;
        const guest = folio.guestId
            ? (await fetchGuestsByIds([folio.guestId])).get(folio.guestId)
            : undefined;
        return attachContext(folio, reservation, guest);
    },
};
//# sourceMappingURL=folio.service.js.map
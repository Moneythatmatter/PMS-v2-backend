import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { enrichReservations } from "../front-office/reservation-enrich.js";
import { supabase } from "../../utils/supabase.js";
async function fetchGroupsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.foGroups)
        .select("id, group_name, group_no")
        .in("id", unique);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const g = toCamel(row);
        map.set(g.id, g);
    }
    return map;
}
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
/** Ledger is source of truth — folio.paid_amount can be overstated when advance was seeded separately. */
async function fetchPaidByFolioIds(folioIds) {
    const totals = new Map();
    const unique = [...new Set(folioIds.filter(Boolean))];
    if (!unique.length)
        return totals;
    const { data, error } = await supabase
        .from(foModel.tables.transactions)
        .select("folio_id, amount, transaction_type, status")
        .in("folio_id", unique)
        .eq("status", "COMPLETED");
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const folioId = String(row.folio_id ?? "").trim();
        if (!folioId)
            continue;
        const amount = Number(row.amount ?? 0);
        const type = String(row.transaction_type ?? "").toUpperCase();
        let delta = 0;
        if (type === "PAYMENT")
            delta = amount;
        else if (type === "REFUND")
            delta = -amount;
        totals.set(folioId, (totals.get(folioId) ?? 0) + delta);
    }
    return totals;
}
function applyPaidFromLedger(folio, paidByFolio) {
    const ledgerPaid = paidByFolio.get(folio.id);
    if (ledgerPaid === undefined)
        return folio;
    const paidAmount = Math.max(0, ledgerPaid);
    const totalAmount = Number(folio.totalAmount ?? 0);
    return {
        ...folio,
        paidAmount,
        balanceAmount: Math.max(0, totalAmount - paidAmount),
    };
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
function attachContext(folio, reservation, guest, group) {
    const isMaster = Boolean(folio.groupId && !folio.bookingId);
    const resolvedGroupId = String(folio.groupId ?? reservation?.groupId ?? "").trim() || null;
    return {
        ...folio,
        guestName: isMaster
            ? group?.groupName ?? guest?.name ?? "Group"
            : reservation?.guestName ?? guest?.name ?? "Guest",
        guestNo: reservation?.guestNo ?? guest?.guestNo ?? null,
        guestPhone: reservation?.phone ?? guest?.mobile ?? null,
        guestEmail: reservation?.email ?? guest?.email ?? null,
        room: reservation?.roomNo ?? null,
        roomType: reservation?.roomType ?? null,
        bookingNo: reservation?.bookingNo ?? group?.groupNo ?? null,
        checkIn: reservation?.checkIn ?? null,
        checkOut: reservation?.checkOut ?? null,
        reservationStatus: reservation?.status ?? null,
        groupName: group?.groupName ??
            reservation?.groupName ??
            null,
        groupNo: group?.groupNo ??
            reservation?.groupNo ??
            null,
        resolvedGroupId,
        isGroupMaster: isMaster,
    };
}
export const FolioService = {
    /** Close all open folios linked to a booking (called on check-out). */
    async closeOpenFoliosForBooking(bookingId) {
        const id = String(bookingId ?? "").trim();
        if (!id)
            return;
        const { error } = await supabase
            .from(foModel.tables.folios)
            .update({
            status: "CLOSED",
            closed_at: new Date().toISOString(),
        })
            .eq("booking_id", id)
            .eq("status", "OPEN");
        if (error)
            throw new Error(error.message);
    },
    async list(filters = {}) {
        const rows = await foModel.list(foModel.tables.folios, {
            filters: {
                booking_id: filters.bookingId,
                guest_id: filters.guestId,
                group_id: filters.groupId,
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
        const folioIds = rows.map((f) => f.id);
        const [reservationMap, guestMap, paidByFolio] = await Promise.all([
            fetchReservationsByIds(bookingIds),
            fetchGuestsByIds(guestIds),
            fetchPaidByFolioIds(folioIds),
        ]);
        const groupIds = [
            ...rows.map((f) => f.groupId),
            ...[...reservationMap.values()].map((r) => r.groupId),
        ].filter((id) => Boolean(id?.trim()));
        const groupMap = await fetchGroupsByIds(groupIds);
        return rows.map((folio) => {
            const reservation = folio.bookingId
                ? reservationMap.get(folio.bookingId)
                : undefined;
            const guest = folio.guestId ? guestMap.get(folio.guestId) : undefined;
            const resolvedGroupId = String(folio.groupId ?? reservation?.groupId ?? "").trim();
            const group = resolvedGroupId
                ? groupMap.get(resolvedGroupId)
                : undefined;
            return applyPaidFromLedger(attachContext(folio, reservation, guest, group), paidByFolio);
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
        const resolvedGroupId = String(folio.groupId ?? reservation?.groupId ?? "").trim();
        const group = resolvedGroupId
            ? (await fetchGroupsByIds([resolvedGroupId])).get(resolvedGroupId)
            : undefined;
        const paidByFolio = await fetchPaidByFolioIds([folio.id]);
        return applyPaidFromLedger(attachContext(folio, reservation, guest, group), paidByFolio);
    },
};
//# sourceMappingURL=folio.service.js.map
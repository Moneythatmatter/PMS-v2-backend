import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Guest, Reservation } from "../../types/front-office.js";
import type { Folio } from "../../types/transactions.js";
import { enrichReservations } from "../front-office/reservation-enrich.js";
import { supabase } from "../../utils/supabase.js";

export type FolioListItem = Folio & {
  guestName?: string;
  guestNo?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  room?: string | null;
  roomType?: string | null;
  bookingNo?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  reservationStatus?: string | null;
};

async function fetchReservationsByIds(ids: string[]): Promise<Map<string, Reservation>> {
  const map = new Map<string, Reservation>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.reservations)
    .select("*")
    .in("id", unique);

  if (error) throw new Error(error.message);

  const enriched = await enrichReservations(
    (data ?? []).map((row) => toCamel<Reservation>(row)),
  );

  for (const row of enriched) {
    map.set(row.id, row);
  }
  return map;
}

/** Ledger is source of truth — folio.paid_amount can be overstated when advance was seeded separately. */
async function fetchPaidByFolioIds(
  folioIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const unique = [...new Set(folioIds.filter(Boolean))];
  if (!unique.length) return totals;

  const { data, error } = await supabase
    .from(foModel.tables.transactions)
    .select("folio_id, amount, transaction_type, status")
    .in("folio_id", unique)
    .eq("status", "COMPLETED");

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const folioId = String(row.folio_id ?? "").trim();
    if (!folioId) continue;
    const amount = Number(row.amount ?? 0);
    const type = String(row.transaction_type ?? "").toUpperCase();
    let delta = 0;
    if (type === "PAYMENT") delta = amount;
    else if (type === "REFUND") delta = -amount;
    totals.set(folioId, (totals.get(folioId) ?? 0) + delta);
  }

  return totals;
}

function applyPaidFromLedger(
  folio: FolioListItem,
  paidByFolio: Map<string, number>,
): FolioListItem {
  const ledgerPaid = paidByFolio.get(folio.id);
  if (ledgerPaid === undefined) return folio;

  const paidAmount = Math.max(0, ledgerPaid);
  const totalAmount = Number(folio.totalAmount ?? 0);
  return {
    ...folio,
    paidAmount,
    balanceAmount: Math.max(0, totalAmount - paidAmount),
  };
}

async function fetchGuestsByIds(ids: string[]): Promise<Map<string, Guest>> {
  const map = new Map<string, Guest>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.guests)
    .select("*")
    .in("id", unique);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const guest = toCamel<Guest>(row);
    map.set(guest.id, guest);
  }
  return map;
}

function attachContext(
  folio: Folio,
  reservation?: Reservation | null,
  guest?: Guest | null,
): FolioListItem {
  return {
    ...folio,
    guestName:
      reservation?.guestName ??
      guest?.name ??
      "Guest",
    guestNo: reservation?.guestNo ?? guest?.guestNo ?? null,
    guestPhone: reservation?.phone ?? guest?.mobile ?? null,
    guestEmail: reservation?.email ?? guest?.email ?? null,
    room: reservation?.roomNo ?? null,
    roomType: reservation?.roomType ?? null,
    bookingNo: reservation?.bookingNo ?? null,
    checkIn: reservation?.checkIn ?? null,
    checkOut: reservation?.checkOut ?? null,
    reservationStatus: reservation?.status ?? null,
  };
}

export const FolioService = {
  /** Close all open folios linked to a booking (called on check-out). */
  async closeOpenFoliosForBooking(bookingId: string): Promise<void> {
    const id = String(bookingId ?? "").trim();
    if (!id) return;

    const { error } = await supabase
      .from(foModel.tables.folios)
      .update({
        status: "CLOSED",
        closed_at: new Date().toISOString(),
      })
      .eq("booking_id", id)
      .eq("status", "OPEN");

    if (error) throw new Error(error.message);
  },

  async list(filters: {
    bookingId?: string;
    guestId?: string;
    status?: string;
  } = {}): Promise<FolioListItem[]> {
    const rows = await foModel.list<Folio>(foModel.tables.folios, {
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
      .filter((id): id is string => Boolean(id?.trim()));
    const guestIds = rows
      .map((f) => f.guestId)
      .filter((id): id is string => Boolean(id?.trim()));

    const folioIds = rows.map((f) => f.id);
    const [reservationMap, guestMap, paidByFolio] = await Promise.all([
      fetchReservationsByIds(bookingIds),
      fetchGuestsByIds(guestIds),
      fetchPaidByFolioIds(folioIds),
    ]);

    return rows.map((folio) => {
      const reservation = folio.bookingId
        ? reservationMap.get(folio.bookingId)
        : undefined;
      const guest = folio.guestId ? guestMap.get(folio.guestId) : undefined;
      return applyPaidFromLedger(
        attachContext(folio, reservation, guest),
        paidByFolio,
      );
    });
  },

  async getById(id: string): Promise<FolioListItem | null> {
    const folio = await foModel.get<Folio>(foModel.tables.folios, id);
    if (!folio) return null;

    const reservation = folio.bookingId
      ? (await fetchReservationsByIds([folio.bookingId])).get(folio.bookingId)
      : undefined;
    const guest = folio.guestId
      ? (await fetchGuestsByIds([folio.guestId])).get(folio.guestId)
      : undefined;

    const paidByFolio = await fetchPaidByFolioIds([folio.id]);
    return applyPaidFromLedger(
      attachContext(folio, reservation, guest),
      paidByFolio,
    );
  },
};

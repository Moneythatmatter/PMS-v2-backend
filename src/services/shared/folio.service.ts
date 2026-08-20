import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Guest, Reservation } from "../../types/front-office.js";
import type { Folio } from "../../types/transactions.js";
import { enrichReservations } from "../front-office/reservation-enrich.js";
import { supabase } from "../../utils/supabase.js";

export type FolioListItem = Folio & {
  guestName?: string;
  guestNo?: string | null;
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
    room: reservation?.roomNo ?? null,
    roomType: reservation?.roomType ?? null,
    bookingNo: reservation?.bookingNo ?? null,
    checkIn: reservation?.checkIn ?? null,
    checkOut: reservation?.checkOut ?? null,
    reservationStatus: reservation?.status ?? null,
  };
}

export const FolioService = {
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

  async getById(id: string): Promise<FolioListItem | null> {
    const folio = await foModel.get<Folio>(foModel.tables.folios, id);
    if (!folio) return null;

    const reservation = folio.bookingId
      ? (await fetchReservationsByIds([folio.bookingId])).get(folio.bookingId)
      : undefined;
    const guest = folio.guestId
      ? (await fetchGuestsByIds([folio.guestId])).get(folio.guestId)
      : undefined;

    return attachContext(folio, reservation, guest);
  },
};

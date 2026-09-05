import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import type { Guest, Reservation, Room } from "../../types/front-office.js";
import { AppError } from "../../errors/index.js";
import {
  fetchRoomsByRefs,
  lookupRoomInMap,
  resolveRoomId,
} from "./room-resolver.js";
import {
  defaultWalkInSourceId,
  fetchBookingSourcesByIds,
  resolveSourceId,
} from "./source-resolver.js";

/** Placeholders like TBA must never touch the rooms table. */
export function isRealRoomRef(roomRef: unknown): roomRef is string {
  const value = String(roomRef ?? "").trim();
  if (!value) return false;
  return !/^(tba|n\/?a|unassigned|-)$/i.test(value);
}

/** Prefer human room number for UI (never expose rooms.id). */
export function displayRoomNo(row: Partial<Reservation>): string {
  return String(row.roomNo ?? "").trim();
}

/** Resolve room ref from API payload (roomRefId or legacy roomNo). */
export function resolveRoomRef(input: Partial<Reservation>): string | null {
  const ref = String(input.roomRefId ?? input.roomNo ?? "").trim();
  return ref || null;
}

const GUEST_ONLY_FIELDS = [
  "guestNo",
  "guestName",
  "phone",
  "email",
  "nationality",
  "gender",
  "dob",
  "address",
  "city",
  "state",
  "country",
  "pincode",
  "idProofType",
  "idNumber",
] as const;

const ROOM_ONLY_FIELDS = ["roomNo", "roomType"] as const;

/** Resolve source ref from API payload (sourceId or legacy source name). */
export function resolveSourceRef(input: Partial<Reservation>): string | null {
  const ref = String(input.sourceId ?? input.source ?? "").trim();
  return ref || null;
}

/** Strip denormalized guest/room/source fields before DB write. */
export function sanitizeReservationInput(
  input: Partial<Reservation>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  const roomRef = resolveRoomRef(input);
  if (roomRef) body.roomRefId = roomRef;
  delete body.roomNo;

  const sourceRef = resolveSourceRef(input);
  if (sourceRef) body.sourceId = sourceRef;

  for (const key of GUEST_ONLY_FIELDS) delete body[key];
  for (const key of ROOM_ONLY_FIELDS) delete body[key];
  delete body.source;
  delete body.bookingNo;
  delete body.guestNo;
  delete body.paymentReference;
  delete body.externalReference;

  return body;
}

/** Resolve room number / UUID from API to rooms.id for FK storage. */
export async function normalizeReservationRoomRef(
  body: Record<string, unknown>,
): Promise<void> {
  if (body.roomRefId == null || body.roomRefId === "") return;
  const raw = String(body.roomRefId).trim();
  const resolved = await resolveRoomId(raw);
  if (resolved) {
    body.roomRefId = resolved;
    return;
  }
  throw new AppError(`Room "${raw}" was not found for this property.`);
}

/** Resolve source name / code / UUID from API to booking_sources.id for FK storage. */
export async function normalizeReservationSourceRef(
  body: Record<string, unknown>,
): Promise<void> {
  if (body.sourceId == null || body.sourceId === "") {
    const fallback = await defaultWalkInSourceId();
    if (fallback) body.sourceId = fallback;
    return;
  }
  const resolved = await resolveSourceId(String(body.sourceId));
  if (resolved) body.sourceId = resolved;
  else delete body.sourceId;
}

function applyGuestFields(
  row: Reservation,
  guest: Guest | undefined,
): Reservation {
  if (!guest) return row;
  return {
    ...row,
    guestNo: guest.guestNo,
    guestName: guest.name,
    phone: guest.mobile,
    email: guest.email,
    nationality: guest.nationality,
    gender: guest.gender,
    dob: guest.dob,
    address: guest.address,
    city: guest.city,
    state: guest.state,
    country: guest.country,
    pincode: guest.pincode,
    idProofType: guest.idType,
    idNumber: guest.idNumber,
  };
}

function applySourceFields(
  row: Reservation,
  source: { name?: string } | undefined,
): Reservation {
  return {
    ...row,
    sourceId: row.sourceId ?? null,
    source: source?.name ?? row.source ?? "",
  };
}

function applyRoomFields(
  row: Reservation,
  room: Room | undefined,
): Reservation {
  return {
    ...row,
    roomRefId: room?.id ?? row.roomRefId ?? null,
    roomNo: room?.roomNo ?? row.roomNo ?? null,
    roomType: room?.roomType ?? row.roomType,
  };
}

async function fetchGuestsByIds(ids: string[]): Promise<Map<string, Guest>> {
  const map = new Map<string, Guest>();
  if (!ids.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.guests)
    .select("*")
    .in("id", ids);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const guest = toCamel<Guest>(row);
    map.set(guest.id, guest);
  }
  return map;
}

/** Attach guest profile + room master fields for API responses. */
export async function enrichReservation(row: Reservation): Promise<Reservation> {
  const guestId = row.guestId ? String(row.guestId) : "";
  const roomRef = resolveRoomRef(row);

  const sourceId = row.sourceId ? String(row.sourceId) : "";

  const [guestMap, roomMap, sourceMap] = await Promise.all([
    guestId ? fetchGuestsByIds([guestId]) : Promise.resolve(new Map()),
    roomRef && isRealRoomRef(roomRef)
      ? fetchRoomsByRefs([roomRef])
      : Promise.resolve(new Map()),
    sourceId
      ? fetchBookingSourcesByIds([sourceId])
      : Promise.resolve(new Map()),
  ]);

  let enriched = applyGuestFields(row, guestMap.get(guestId));
  enriched = applyRoomFields(
    enriched,
    roomRef ? lookupRoomInMap(roomMap, roomRef) : undefined,
  );
  enriched = applySourceFields(enriched, sourceMap.get(sourceId));
  return enriched;
}

export async function enrichReservations(
  rows: Reservation[],
): Promise<Reservation[]> {
  if (!rows.length) return [];

  const guestIds = [
    ...new Set(rows.map((r) => r.guestId).filter(Boolean) as string[]),
  ];
  const roomRefs = [
    ...new Set(
      rows
        .map((r) => resolveRoomRef(r))
        .filter((ref): ref is string => !!ref && isRealRoomRef(ref)),
    ),
  ];

  const sourceIds = [
    ...new Set(rows.map((r) => r.sourceId).filter(Boolean) as string[]),
  ];

  const [guestMap, roomMap, sourceMap] = await Promise.all([
    fetchGuestsByIds(guestIds),
    fetchRoomsByRefs(roomRefs),
    fetchBookingSourcesByIds(sourceIds),
  ]);

  return rows.map((row) => {
    const guestId = row.guestId ? String(row.guestId) : "";
    const roomRef = resolveRoomRef(row);
    const sourceId = row.sourceId ? String(row.sourceId) : "";
    let enriched = applyGuestFields(row, guestMap.get(guestId));
    enriched = applyRoomFields(
      enriched,
      roomRef ? lookupRoomInMap(roomMap, roomRef) : undefined,
    );
    enriched = applySourceFields(enriched, sourceMap.get(sourceId));
    return enriched;
  });
}

/** Load guest name for activity logs and room inventory updates. */
export async function guestDisplayName(
  guestId: string | null | undefined,
  fallback = "Guest",
): Promise<string> {
  if (!guestId) return fallback;
  const guest = await foModel.get<Guest>(foModel.tables.guests, guestId);
  return guest?.name?.trim() || fallback;
}

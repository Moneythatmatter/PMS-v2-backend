import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import type { LostFoundItemRow } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type GuestRow = { id: string; name?: string };
type UserRow = { id: string; name?: string };

function isFoundByFkError(message: string): boolean {
  return /lost_found_items_found_by_fkey/i.test(message);
}

function appendFoundByNote(notes: unknown, label: string): string {
  const line = `Found by: ${label}`;
  const base = String(notes ?? "").trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base} · ${line}`;
}

export function sanitizeLostFoundItemInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  if (body.item != null && body.itemName == null) body.itemName = body.item;
  if (body.name != null && body.itemName == null) body.itemName = body.name;
  if (body.room != null && body.roomId == null) body.roomId = body.room;
  if (body.roomNo != null && body.roomId == null) body.roomId = body.roomNo;
  if (body.guest != null && body.guestName == null) body.guestName = body.guest;
  if (body.guestName != null && body.guestId == null && body.guest == null) {
    body.guest = body.guestName;
  }
  if (body.foundByStaff != null && body.foundBy == null) {
    body.foundBy = body.foundByStaff;
  }
  if (body.foundLocation == null && body.location != null) {
    body.foundLocation = body.location;
  }
  if (body.foundLocation == null && body.room != null) {
    body.foundLocation = body.room;
  }
  if (body.storedLocation == null && body.storage != null) {
    body.storedLocation = body.storage;
  }
  if (body.foundDate != null && body.foundAt == null) {
    body.foundAt = body.foundDate;
  }
  if (body.returnedDate != null && body.claimedAt == null) {
    body.claimedAt = body.returnedDate;
  }
  if (body.claimBy != null && body.returnedTo == null) {
    body.returnedTo = body.claimBy;
  }
  if (body.returnMethod == null && body.returnedVia != null) {
    body.returnMethod = body.returnedVia;
  }

  delete body.item;
  delete body.name;
  delete body.room;
  delete body.roomNo;
  delete body.guestName;
  delete body.foundByStaff;
  delete body.location;
  delete body.storage;
  delete body.foundDate;
  delete body.returnedDate;
  delete body.claimBy;
  delete body.returnedVia;
  delete body.itemNumber;
  delete body.createdAt;
  delete body.updatedAt;

  return body;
}

export async function persistLostFoundItemRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  foundByLabel?: string,
): Promise<LostFoundItemRow> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<LostFoundItemRow>(
        hkModel.shared.lostFoundItems,
        body,
      );
    }
    return hkModel.update<LostFoundItemRow>(
      hkModel.shared.lostFoundItems,
      options.id,
      body,
    );
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isFoundByFkError(message) || !foundByLabel) throw error;

    const fallback: Record<string, unknown> = {
      ...payload,
      foundBy: null,
      notes: appendFoundByNote(payload.notes, foundByLabel),
    };
    return save(fallback);
  }
}

async function fetchRoomsByIds(ids: string[]): Promise<Map<string, FoRoom>> {
  const map = new Map<string, FoRoom>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_no")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const room = toCamel<FoRoom>(row);
    map.set(room.id, room);
  }
  return map;
}

async function fetchGuestsByIds(ids: string[]): Promise<Map<string, GuestRow>> {
  const map = new Map<string, GuestRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("guests")
    .select("id, name")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const guest = toCamel<GuestRow>(row);
    map.set(guest.id, guest);
  }
  return map;
}

async function fetchUsersByIds(ids: string[]): Promise<Map<string, UserRow>> {
  const map = new Map<string, UserRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const user = toCamel<UserRow>(row);
    map.set(user.id, user);
  }
  return map;
}

function applyEnrichment(
  row: LostFoundItemRow,
  room?: FoRoom,
  guest?: GuestRow,
  claimedGuest?: GuestRow,
  user?: UserRow,
): LostFoundItemRow {
  return {
    ...row,
    roomNo: room?.roomNo ?? row.roomNo,
    guestName: guest?.name ?? row.guestName,
    claimedByName: claimedGuest?.name ?? row.claimedByName,
    foundByName: user?.name ?? row.foundByName,
  };
}

export async function enrichLostFoundItem(
  row: LostFoundItemRow,
): Promise<LostFoundItemRow> {
  const roomId = row.roomId ? String(row.roomId) : "";
  const guestId = row.guestId ? String(row.guestId) : "";
  const claimedBy = row.claimedBy ? String(row.claimedBy) : "";
  const foundBy = row.foundBy ? String(row.foundBy) : "";

  const [roomMap, guestMap, userMap] = await Promise.all([
    roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
    fetchGuestsByIds([guestId, claimedBy].filter(Boolean)),
    foundBy ? fetchUsersByIds([foundBy]) : Promise.resolve(new Map()),
  ]);

  return applyEnrichment(
    row,
    roomId ? roomMap.get(roomId) : undefined,
    guestId ? guestMap.get(guestId) : undefined,
    claimedBy ? guestMap.get(claimedBy) : undefined,
    foundBy ? userMap.get(foundBy) : undefined,
  );
}

export async function enrichLostFoundItems(
  rows: LostFoundItemRow[],
): Promise<LostFoundItemRow[]> {
  if (!rows.length) return [];

  const roomIds = [
    ...new Set(rows.map((r) => String(r.roomId ?? "")).filter(Boolean)),
  ];
  const guestIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.guestId, r.claimedBy])
        .filter(Boolean)
        .map(String),
    ),
  ];
  const userIds = [
    ...new Set(rows.map((r) => String(r.foundBy ?? "")).filter(Boolean)),
  ];

  const [roomMap, guestMap, userMap] = await Promise.all([
    fetchRoomsByIds(roomIds),
    fetchGuestsByIds(guestIds),
    fetchUsersByIds(userIds),
  ]);

  return rows.map((row) =>
    applyEnrichment(
      row,
      row.roomId ? roomMap.get(String(row.roomId)) : undefined,
      row.guestId ? guestMap.get(String(row.guestId)) : undefined,
      row.claimedBy ? guestMap.get(String(row.claimedBy)) : undefined,
      row.foundBy ? userMap.get(String(row.foundBy)) : undefined,
    ),
  );
}

export async function resolveLostFoundItemId(
  key: string,
): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<LostFoundItemRow>(
    hkModel.shared.lostFoundItems,
    trimmed,
  );
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(hkModel.shared.lostFoundItems)
    .select("id")
    .eq("item_number", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveRoomIdForLostFound(
  key: string,
): Promise<string | null> {
  return resolveRoomId(key);
}

export async function resolveGuestIdByName(
  input: unknown,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!raw || /^unknown$/i.test(raw)) return null;

  const { data: byId } = await supabase
    .from("guests")
    .select("id")
    .eq("id", raw)
    .maybeSingle();
  if (byId?.id) return String(byId.id);

  const { data: rows } = await supabase.from("guests").select("id, name");
  const exact = (rows ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === raw.toLowerCase(),
  );
  return exact?.id ? String(exact.id) : null;
}

export async function resolveFoundByUserId(
  input: unknown,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "—") return null;

  const { data: byId } = await supabase
    .from("users")
    .select("id")
    .eq("id", raw)
    .maybeSingle();
  if (byId?.id) return String(byId.id);

  const { data: rows } = await supabase.from("users").select("id, name");
  const exact = (rows ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === raw.toLowerCase(),
  );
  return exact?.id ? String(exact.id) : null;
}

export async function resolveFoundByUserLabel(
  input: unknown,
): Promise<string> {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "—") return "";

  const { data: byId } = await supabase
    .from("users")
    .select("name")
    .eq("id", raw)
    .maybeSingle();
  if (byId?.name) return String(byId.name);

  const { data: rows } = await supabase.from("users").select("id, name");
  const exact = (rows ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === raw.toLowerCase(),
  );
  if (exact?.name) return String(exact.name);
  return raw;
}

export function parseFoundAt(input: unknown, fallback = new Date()): string {
  if (input == null || input === "") {
    return fallback.toISOString();
  }
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return fallback.toISOString();
}

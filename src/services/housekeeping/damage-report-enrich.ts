import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import type { DamageReportRow } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type GuestRow = { id: string; name?: string };
type UserRow = { id: string; name?: string };

function isReportedByFkError(message: string): boolean {
  return /damage_reports_reported_by_fkey/i.test(message);
}

function appendReporterNote(notes: unknown, label: string): string {
  const line = `Reported by: ${label}`;
  const base = String(notes ?? "").trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base} · ${line}`;
}

export function sanitizeDamageReportInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  if (body.room != null && body.roomId == null) body.roomId = body.room;
  if (body.roomNo != null && body.roomId == null) body.roomId = body.roomNo;
  if (body.damageType == null && body.category != null) {
    body.damageType = body.category;
  }
  if (body.reportedByStaff != null && body.reportedBy == null) {
    body.reportedBy = body.reportedByStaff;
  }
  if (body.estimatedCost == null && body.estCost != null) {
    body.estimatedCost = body.estCost;
  }
  if (body.actualCost == null && body.actual_cost != null) {
    body.actualCost = body.actual_cost;
  }
  if (body.assetId == null && body.assetTag != null) {
    body.assetId = body.assetTag;
  }
  if (body.guest != null && body.guestName == null) body.guestName = body.guest;

  delete body.room;
  delete body.roomNo;
  delete body.category;
  delete body.reportedByStaff;
  delete body.estCost;
  delete body.actual_cost;
  delete body.assetTag;
  delete body.guestName;
  delete body.guest;
  delete body.reportNumber;
  delete body.createdAt;
  delete body.updatedAt;

  return body;
}

export async function persistDamageReportRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  reporterLabel?: string,
): Promise<DamageReportRow> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<DamageReportRow>(
        hkModel.tables.damageReports,
        body,
      );
    }
    return hkModel.update<DamageReportRow>(
      hkModel.tables.damageReports,
      options.id,
      body,
    );
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isReportedByFkError(message) || !reporterLabel) throw error;

    const fallback: Record<string, unknown> = {
      ...payload,
      reportedBy: null,
      notes: appendReporterNote(payload.notes, reporterLabel),
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
  row: DamageReportRow,
  room?: FoRoom,
  guest?: GuestRow,
  user?: UserRow,
): DamageReportRow {
  return {
    ...row,
    roomNo: room?.roomNo ?? row.roomNo,
    guestName: guest?.name ?? row.guestName,
    reportedByName: user?.name ?? row.reportedByName,
  };
}

export async function enrichDamageReport(
  row: DamageReportRow,
): Promise<DamageReportRow> {
  const roomId = row.roomId ? String(row.roomId) : "";
  const guestId = row.guestId ? String(row.guestId) : "";
  const reportedBy = row.reportedBy ? String(row.reportedBy) : "";

  const [roomMap, guestMap, userMap] = await Promise.all([
    roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
    guestId ? fetchGuestsByIds([guestId]) : Promise.resolve(new Map()),
    reportedBy ? fetchUsersByIds([reportedBy]) : Promise.resolve(new Map()),
  ]);

  return applyEnrichment(
    row,
    roomId ? roomMap.get(roomId) : undefined,
    guestId ? guestMap.get(guestId) : undefined,
    reportedBy ? userMap.get(reportedBy) : undefined,
  );
}

export async function enrichDamageReports(
  rows: DamageReportRow[],
): Promise<DamageReportRow[]> {
  if (!rows.length) return [];

  const roomIds = [
    ...new Set(rows.map((r) => String(r.roomId ?? "")).filter(Boolean)),
  ];
  const guestIds = [
    ...new Set(rows.map((r) => String(r.guestId ?? "")).filter(Boolean)),
  ];
  const userIds = [
    ...new Set(rows.map((r) => String(r.reportedBy ?? "")).filter(Boolean)),
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
      row.reportedBy ? userMap.get(String(row.reportedBy)) : undefined,
    ),
  );
}

export async function resolveDamageReportId(
  key: string,
): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<DamageReportRow>(
    hkModel.tables.damageReports,
    trimmed,
  );
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(hkModel.tables.damageReports)
    .select("id")
    .eq("report_number", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveRoomIdForDamageReport(
  key: string,
): Promise<string | null> {
  return resolveRoomId(key);
}

export async function resolveGuestIdByName(
  input: unknown,
): Promise<string | null> {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

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

export async function resolveReporterUserId(
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

export async function resolveReporterUserLabel(
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

export function parseReportedAt(
  input: unknown,
  fallback = new Date(),
): string {
  if (input == null || input === "") return fallback.toISOString();
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return fallback.toISOString();
}

export function parseCost(input: unknown): number {
  if (input == null || input === "") return 0;
  const n = Number(String(input).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

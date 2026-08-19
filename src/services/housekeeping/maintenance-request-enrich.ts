import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { resolveRoomId } from "./hk-room-enrich.js";
import {
  resolveGuestRequestAssignee,
  resolveGuestRequestAssigneeLabel,
} from "./guest-request-enrich.js";
import type { MaintenanceRequestRow } from "../../types/housekeeping.js";

type FoRoom = { id: string; roomNo?: string };
type PublicAreaRow = { id: string; name?: string; areaCode?: string };
type StaffRow = { id: string; name?: string };
type UserRow = { id: string; name?: string };

export const resolveMaintenanceAssignee = resolveGuestRequestAssignee;
export const resolveMaintenanceAssigneeLabel = resolveGuestRequestAssigneeLabel;

function isStaffFkError(message: string): boolean {
  return /maintenance_requests_(assigned_to|reported_by|verified_by)_fkey/i.test(
    message,
  );
}

function appendStaffNote(notes: unknown, label: string, prefix: string): string {
  const line = `${prefix}: ${label}`;
  const base = String(notes ?? "").trim();
  if (!base) return line;
  if (base.includes(line)) return base;
  return `${base} · ${line}`;
}

export async function persistMaintenanceRequestRow(
  payload: Record<string, unknown>,
  options: { mode: "create" } | { mode: "update"; id: string },
  staffNotes?: { assigned?: string; reported?: string; verified?: string },
): Promise<MaintenanceRequestRow> {
  const save = async (body: Record<string, unknown>) => {
    if (options.mode === "create") {
      return hkModel.create<MaintenanceRequestRow>(
        hkModel.shared.maintenanceRequests,
        body,
      );
    }
    return hkModel.update<MaintenanceRequestRow>(
      hkModel.shared.maintenanceRequests,
      options.id,
      body,
    );
  };

  try {
    return await save(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isStaffFkError(message)) throw error;

    const fallback: Record<string, unknown> = { ...payload };
    let notes = payload.notes;
    if (staffNotes?.assigned) {
      fallback.assignedTo = null;
      notes = appendStaffNote(notes, staffNotes.assigned, "Assigned to");
    }
    if (staffNotes?.reported) {
      fallback.reportedBy = null;
      notes = appendStaffNote(notes, staffNotes.reported, "Reported by");
    }
    if (staffNotes?.verified) {
      fallback.verifiedBy = null;
      notes = appendStaffNote(notes, staffNotes.verified, "Verified by");
    }
    fallback.notes = notes;
    return save(fallback);
  }
}

export function sanitizeMaintenanceRequestInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };

  if (body.roomRefId != null && body.roomId == null) body.roomId = body.roomRefId;
  if (body.roomNo != null && body.roomId == null) body.roomId = body.roomNo;
  if (body.room != null && body.roomId == null) body.roomId = body.room;
  if (body.publicAreaRefId != null && body.publicAreaId == null) {
    body.publicAreaId = body.publicAreaRefId;
  }
  if (body.areaId != null && body.publicAreaId == null) {
    body.publicAreaId = body.areaId;
  }
  if (body.problem != null && body.description == null) {
    body.description = body.problem;
  }
  if (body.category != null && body.issueType == null) {
    body.issueType = body.category;
  }
  if (body.selectedCategory != null && body.issueType == null) {
    body.issueType = body.selectedCategory;
  }
  if (body.engineer != null && body.assignedTo == null) {
    body.assignedTo = body.engineer;
  }
  if (body.assignedStaff != null && body.assignedTo == null) {
    body.assignedTo = body.assignedStaff;
  }
  if (body.remarks != null && body.notes == null) body.notes = body.remarks;
  if (body.estimatedCompletion != null && body.estimatedCompletionAt == null) {
    body.estimatedCompletionAt = body.estimatedCompletion;
  }

  if (body.problem != null && body.title == null) {
    const problem = String(body.problem);
    const parts = problem.split(/\s[—-]\s/);
    body.title = parts[0]?.trim() || "Maintenance";
    if (!body.description) {
      body.description = parts.slice(1).join(" — ").trim() || problem;
    }
  }

  delete body.roomRefId;
  delete body.roomNo;
  delete body.room;
  delete body.publicAreaRefId;
  delete body.areaId;
  delete body.problem;
  delete body.category;
  delete body.selectedCategory;
  delete body.engineer;
  delete body.assignedStaff;
  delete body.remarks;
  delete body.estimatedCompletion;
  delete body.requestNumber;
  delete body.updatedAt;
  delete body.createdAt;
  delete body.assignmentType;
  delete body.assignmentHistory;
  delete body.createdAtLabel;
  delete body.actualCompletion;
  delete body.attachments;

  return body;
}

async function fetchRoomsByIds(ids: string[]): Promise<Map<string, FoRoom>> {
  const map = new Map<string, FoRoom>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(foModel.tables.rooms)
    .select("id, room_no")
    .in("id", unique);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const room = toCamel<FoRoom>(row);
    map.set(room.id, room);
  }
  return map;
}

async function fetchPublicAreasByIds(
  ids: string[],
): Promise<Map<string, PublicAreaRow>> {
  const map = new Map<string, PublicAreaRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("public_areas")
    .select("id, name, area_code")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const area = toCamel<PublicAreaRow>(row);
    map.set(area.id, area);
  }
  return map;
}

async function fetchStaffByIds(ids: string[]): Promise<Map<string, StaffRow>> {
  const map = new Map<string, StaffRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from(hkModel.tables.staff)
    .select("id, name")
    .in("id", unique);

  if (error) return map;
  for (const row of data ?? []) {
    const staff = toCamel<StaffRow>(row);
    map.set(staff.id, staff);
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

function staffName(
  key: string | null | undefined,
  staff: Map<string, StaffRow>,
  users: Map<string, UserRow>,
): string | undefined {
  if (!key) return undefined;
  return (
    staff.get(String(key))?.name ??
    users.get(String(key))?.name ??
    (String(key) || undefined)
  );
}

function applyEnrichment(
  row: MaintenanceRequestRow,
  room?: FoRoom,
  publicArea?: PublicAreaRow,
  staff: Map<string, StaffRow> = new Map(),
  users: Map<string, UserRow> = new Map(),
): MaintenanceRequestRow {
  return {
    ...row,
    roomNo: room?.roomNo ?? row.roomNo,
    publicAreaName:
      publicArea?.name ?? publicArea?.areaCode ?? row.publicAreaName,
    assignedToName: staffName(row.assignedTo, staff, users),
    reportedByName: staffName(row.reportedBy, staff, users),
    verifiedByName: staffName(row.verifiedBy, staff, users),
  };
}

export async function enrichMaintenanceRequest(
  row: MaintenanceRequestRow,
): Promise<MaintenanceRequestRow> {
  const roomId = row.roomId ? String(row.roomId) : "";
  const publicAreaId = row.publicAreaId ? String(row.publicAreaId) : "";
  const staffIds = [row.assignedTo, row.reportedBy, row.verifiedBy]
    .filter(Boolean)
    .map(String);

  const [roomMap, areaMap, staffMap, userMap] = await Promise.all([
    roomId ? fetchRoomsByIds([roomId]) : Promise.resolve(new Map()),
    publicAreaId
      ? fetchPublicAreasByIds([publicAreaId])
      : Promise.resolve(new Map()),
    fetchStaffByIds(staffIds),
    fetchUsersByIds(staffIds),
  ]);

  return applyEnrichment(
    row,
    roomId ? roomMap.get(roomId) : undefined,
    publicAreaId ? areaMap.get(publicAreaId) : undefined,
    staffMap,
    userMap,
  );
}

export async function enrichMaintenanceRequests(
  rows: MaintenanceRequestRow[],
): Promise<MaintenanceRequestRow[]> {
  if (!rows.length) return [];

  const roomIds = [
    ...new Set(rows.map((r) => String(r.roomId ?? "")).filter(Boolean)),
  ];
  const areaIds = [
    ...new Set(rows.map((r) => String(r.publicAreaId ?? "")).filter(Boolean)),
  ];
  const staffIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignedTo, r.reportedBy, r.verifiedBy])
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [roomMap, areaMap, staffMap, userMap] = await Promise.all([
    fetchRoomsByIds(roomIds),
    fetchPublicAreasByIds(areaIds),
    fetchStaffByIds(staffIds),
    fetchUsersByIds(staffIds),
  ]);

  return rows.map((row) =>
    applyEnrichment(
      row,
      row.roomId ? roomMap.get(String(row.roomId)) : undefined,
      row.publicAreaId ? areaMap.get(String(row.publicAreaId)) : undefined,
      staffMap,
      userMap,
    ),
  );
}

export async function resolveMaintenanceRequestId(
  key: string,
): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byId = await hkModel.get<MaintenanceRequestRow>(
    hkModel.shared.maintenanceRequests,
    trimmed,
  );
  if (byId?.id) return byId.id;

  const { data, error } = await supabase
    .from(hkModel.shared.maintenanceRequests)
    .select("id")
    .eq("request_number", trimmed)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveRoomIdForMaintenance(
  key: string,
): Promise<string | null> {
  return resolveRoomId(key);
}

export async function resolvePublicAreaId(key: string): Promise<string | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const { data: byId } = await supabase
    .from("public_areas")
    .select("id")
    .eq("id", trimmed)
    .maybeSingle();
  if (byId?.id) return String(byId.id);

  const { data: byCode } = await supabase
    .from("public_areas")
    .select("id")
    .eq("area_code", trimmed)
    .maybeSingle();
  if (byCode?.id) return String(byCode.id);

  const { data: byName } = await supabase
    .from("public_areas")
    .select("id")
    .ilike("name", trimmed)
    .maybeSingle();
  return byName?.id ? String(byName.id) : null;
}

/** Parse legacy "2 Hours" / "24 Hours" into ISO timestamp from base time. */
export function parseEstimatedCompletionAt(
  input: unknown,
  base = new Date(),
): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(hour|hr|minute|min|day)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const result = new Date(base);
  if (unit.startsWith("day")) {
    result.setDate(result.getDate() + amount);
  } else if (unit.startsWith("min")) {
    result.setMinutes(result.getMinutes() + amount);
  } else {
    result.setHours(result.getHours() + amount);
  }
  return result.toISOString();
}

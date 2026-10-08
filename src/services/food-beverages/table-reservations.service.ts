import { fbModel } from "../../models/food-beverages/index.js";
import { supabase } from "../../utils/supabase.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../../errors/index.js";
import {
  formatPropertyTime,
  isIsoDate,
  normalizeTime,
  propertyToday,
  zonedDateTimeToUtc,
} from "../../utils/property-time.js";

type Row = Record<string, unknown>;

export type ReservationStatus = "Confirmed" | "Seated" | "Completed" | "No Show" | "Cancelled";

/**
 * Where a reservation stands right now. Only `reserved` and `late` hold the table:
 * upcoming → (start − buffer) reserved → start → late → (start + grace) overdue → auto No Show.
 */
export type ReservationPhase =
  | "unscheduled"
  | "upcoming"
  | "reserved"
  | "late"
  | "overdue"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled";

export type ReservationSettings = {
  scopeKey: string;
  bufferBeforeMin: number;
  gracePeriodMin: number;
  defaultDurationMin: number;
  updatedAt?: string;
};

export type EnrichedReservation = Row & {
  id: string;
  resNo: string;
  outletId: string;
  guest: string;
  phone: string;
  covers: number;
  tableNo: string;
  tableNos: string[];
  status: ReservationStatus;
  reservationDate: string | null;
  time: string;
  durationMin: number;
  startsAt: string | null;
  endsAt: string | null;
  blockFrom: string | null;
  graceEndsAt: string | null;
  bufferBeforeMin: number;
  gracePeriodMin: number;
  phase: ReservationPhase;
  sessionId: string | null;
};

export type TableReservationOverlay = {
  id: string;
  resNo: string;
  guest: string;
  phone: string;
  time: string;
  covers: number;
  startsAt: string | null;
  blockFrom: string | null;
  graceEndsAt: string | null;
  endsAt: string | null;
  phase: ReservationPhase;
  /** Window is active but the table is physically taken by someone else. */
  conflict: boolean;
};

const T = fbModel.tables;
const SETTINGS_TABLE = "fb_reservation_settings";
const GLOBAL = "global";
const DEFAULTS = { bufferBeforeMin: 15, gracePeriodMin: 15, defaultDurationMin: 90 };
const LIMITS = {
  bufferBeforeMin: [0, 240],
  gracePeriodMin: [0, 240],
  defaultDurationMin: [15, 720],
} as const;
const MINUTE = 60_000;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const nowIso = () => new Date().toISOString();

/** Merged bookings keep several tables in one field, e.g. "T-14A+T-14B". */
export function reservationTableNos(tableNo: unknown) {
  return String(tableNo ?? "")
    .split(/[+,]/)
    .map((t) => t.trim())
    .filter((t) => t && t !== "—");
}

const tableKey = (outletId: unknown, tableNo: unknown) => `${String(outletId ?? "")}|${norm(tableNo)}`;

// ── Settings ─────────────────────────────────────────────────────────────────

function toSettings(row: Row | undefined, scopeKey: string, base = DEFAULTS): ReservationSettings {
  return {
    scopeKey,
    bufferBeforeMin: row?.bufferBeforeMin != null ? num(row.bufferBeforeMin) : base.bufferBeforeMin,
    gracePeriodMin: row?.gracePeriodMin != null ? num(row.gracePeriodMin) : base.gracePeriodMin,
    defaultDurationMin: row?.defaultDurationMin != null ? num(row.defaultDurationMin) : base.defaultDurationMin,
    ...(row?.updatedAt ? { updatedAt: String(row.updatedAt) } : {}),
  };
}

type SettingsIndex = { global: ReservationSettings; outlets: Map<string, ReservationSettings> };

async function loadSettings(): Promise<SettingsIndex> {
  let rows: Row[] = [];
  try {
    rows = await fbModel.list<Row>(SETTINGS_TABLE);
  } catch {
    rows = [];
  }
  const global = toSettings(rows.find((r) => r.scopeKey === GLOBAL), GLOBAL);
  const outlets = new Map<string, ReservationSettings>();
  for (const r of rows) {
    if (r.scopeKey === GLOBAL) continue;
    outlets.set(String(r.scopeKey), toSettings(r, String(r.scopeKey), global));
  }
  return { global, outlets };
}

const settingsFor = (index: SettingsIndex, outletId: unknown) =>
  index.outlets.get(String(outletId ?? "")) ?? { ...index.global, scopeKey: String(outletId ?? GLOBAL) };

// ── Windows ──────────────────────────────────────────────────────────────────

function windowFor(row: Row, settings: ReservationSettings) {
  let startsAt = row.startsAt ? new Date(String(row.startsAt)) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    const time = normalizeTime(row.time);
    startsAt = isIsoDate(row.reservationDate) && time ? zonedDateTimeToUtc(row.reservationDate, time) : null;
  }
  if (!startsAt) return null;
  const duration = Math.max(15, num(row.durationMin, settings.defaultDurationMin));
  const endsAt = row.endsAt ? new Date(String(row.endsAt)) : new Date(startsAt.getTime() + duration * MINUTE);
  return {
    startsAt,
    endsAt,
    blockFrom: new Date(startsAt.getTime() - settings.bufferBeforeMin * MINUTE),
    graceEndsAt: new Date(startsAt.getTime() + settings.gracePeriodMin * MINUTE),
  };
}

function phaseOf(status: string, win: ReturnType<typeof windowFor>, now: number): ReservationPhase {
  if (status === "Seated") return "seated";
  if (status === "Completed") return "completed";
  if (status === "No Show") return "no_show";
  if (status === "Cancelled") return "cancelled";
  if (!win) return "unscheduled";
  if (now < win.blockFrom.getTime()) return "upcoming";
  if (now < win.startsAt.getTime()) return "reserved";
  if (now < win.graceEndsAt.getTime()) return "late";
  return "overdue";
}

export const isBlockingPhase = (phase: ReservationPhase) => phase === "reserved" || phase === "late";

function enrich(row: Row, settings: ReservationSettings, now = Date.now()): EnrichedReservation {
  const win = windowFor(row, settings);
  const status = (text(row.status) || "Confirmed") as ReservationStatus;
  return {
    ...row,
    id: String(row.id),
    resNo: text(row.resNo),
    outletId: text(row.outletId),
    guest: text(row.guest),
    phone: text(row.phone),
    covers: num(row.covers, 0),
    tableNo: text(row.tableNo),
    tableNos: reservationTableNos(row.tableNo),
    status,
    reservationDate: isIsoDate(row.reservationDate) ? row.reservationDate : null,
    time: normalizeTime(row.time) ?? text(row.time),
    durationMin: Math.max(15, num(row.durationMin, settings.defaultDurationMin)),
    startsAt: win?.startsAt.toISOString() ?? null,
    endsAt: win?.endsAt.toISOString() ?? null,
    blockFrom: win?.blockFrom.toISOString() ?? null,
    graceEndsAt: win?.graceEndsAt.toISOString() ?? null,
    bufferBeforeMin: settings.bufferBeforeMin,
    gracePeriodMin: settings.gracePeriodMin,
    phase: phaseOf(status, win, now),
    sessionId: row.sessionId ? String(row.sessionId) : null,
  };
}

const intervalsOverlap = (aFrom: string, aTo: string, bFrom: string, bTo: string) =>
  new Date(aFrom).getTime() < new Date(bTo).getTime() && new Date(bFrom).getTime() < new Date(aTo).getTime();

const timeLabel = (iso: string | null) => (iso ? formatPropertyTime(new Date(iso)) : "—");

// ── Reads ────────────────────────────────────────────────────────────────────

async function listByStatus(statuses: ReservationStatus[], outletId?: string) {
  const lists = await Promise.all(
    statuses.map((status) =>
      fbModel.list<Row>(T.reservations, { filters: { status, ...(outletId ? { outlet_id: outletId } : {}) } }),
    ),
  );
  return lists.flat();
}

async function getRaw(id: string) {
  const row = await fbModel.get<Row>(T.reservations, id);
  if (!row) throw new NotFoundError("Reservation not found");
  return row;
}

async function getEnriched(id: string) {
  const [row, settings] = await Promise.all([getRaw(id), loadSettings()]);
  return enrich(row, settingsFor(settings, row.outletId));
}

/** Confirmed/Seated bookings on any of these tables whose windows overlap [from, to). */
async function findConflicts(input: {
  outletId: string;
  tableNos: string[];
  from: string;
  to: string;
  excludeId?: string;
  settings: SettingsIndex;
}) {
  const wanted = new Set(input.tableNos.map(norm));
  const rows = await listByStatus(["Confirmed", "Seated"], input.outletId);
  return rows
    .filter((r) => String(r.id) !== input.excludeId)
    .map((r) => enrich(r, settingsFor(input.settings, r.outletId)))
    .filter((r) => r.blockFrom && r.endsAt && r.phase !== "overdue")
    .filter((r) => r.tableNos.some((t) => wanted.has(norm(t))))
    .filter((r) => intervalsOverlap(input.from, input.to, r.blockFrom as string, r.endsAt as string));
}

// ── Writes ───────────────────────────────────────────────────────────────────

type ReservationInput = {
  guest: string;
  phone: string;
  reservationDate: string;
  time: string;
  covers: number;
  outletId: string;
  tableNo: string;
  durationMin: number;
  notes: string;
};

async function validate(body: Row, prev: EnrichedReservation | null, settings: SettingsIndex) {
  const pick = <K extends keyof ReservationInput>(key: K, fallback: unknown) =>
    body[key] !== undefined ? body[key] : fallback;

  const input: ReservationInput = {
    guest: text(pick("guest", prev?.guest)),
    phone: text(pick("phone", prev?.phone)),
    reservationDate: text(pick("reservationDate", prev?.reservationDate)),
    time: normalizeTime(pick("time", prev?.time)) ?? "",
    covers: Math.floor(num(pick("covers", prev?.covers), 0)),
    outletId: text(pick("outletId", prev?.outletId)),
    tableNo: reservationTableNos(pick("tableNo", prev?.tableNo)).join("+"),
    durationMin: Math.floor(
      num(pick("durationMin", prev?.durationMin), settingsFor(settings, pick("outletId", prev?.outletId)).defaultDurationMin),
    ),
    notes: text(pick("notes", prev?.notes ?? "")),
  };

  const details: { path: string; message: string }[] = [];
  if (!input.guest) details.push({ path: "guest", message: "Guest name is required" });
  if (input.phone && !/^\+?[\d\s-]{7,16}$/.test(input.phone)) {
    details.push({ path: "phone", message: "Enter a valid phone number" });
  }
  if (!isIsoDate(input.reservationDate)) details.push({ path: "reservationDate", message: "Pick a reservation date" });
  if (!input.time) details.push({ path: "time", message: "Pick a reservation time" });
  if (input.covers < 1) details.push({ path: "covers", message: "Guest count must be at least 1" });
  if (!input.outletId) details.push({ path: "outletId", message: "Choose an outlet" });
  if (!input.tableNo) details.push({ path: "tableNo", message: "Choose a table" });
  if (input.durationMin < 15 || input.durationMin > 720) {
    details.push({ path: "durationMin", message: "Dining duration must be between 15 minutes and 12 hours" });
  }

  if (input.outletId && input.tableNo) {
    const tables = await fbModel.list<Row>(T.liveTables, { filters: { outlet_id: input.outletId } });
    const known = new Set(tables.map((t) => norm(t.tableNo)));
    const missing = reservationTableNos(input.tableNo).filter((t) => !known.has(norm(t)));
    if (missing.length) details.push({ path: "tableNo", message: `${missing.join(", ")} is not a table at this outlet` });
  }

  if (details.length === 0) {
    const startsAt = zonedDateTimeToUtc(input.reservationDate, input.time);
    const scheduleChanged =
      !prev || prev.reservationDate !== input.reservationDate || prev.time !== input.time;
    if (scheduleChanged && startsAt.getTime() < Date.now() - 5 * MINUTE) {
      details.push({ path: "time", message: "That date and time has already passed" });
    }
  }
  if (details.length) throw new ValidationError(details.map((d) => d.message).join("; "), details);

  const startsAt = zonedDateTimeToUtc(input.reservationDate, input.time);
  const endsAt = new Date(startsAt.getTime() + input.durationMin * MINUTE);
  return { input, startsAt, endsAt };
}

function conflictMessage(conflicts: EnrichedReservation[]) {
  const list = conflicts
    .map((c) => `${c.resNo || "reservation"} · ${c.guest} on ${c.tableNos.join("+")} (${timeLabel(c.blockFrom)}–${timeLabel(c.endsAt)})`)
    .join("; ");
  return `This table is already held during that time: ${list}. Pick another table or time, or save with override.`;
}

async function save(id: string | null, body: Row) {
  const settings = await loadSettings();
  const prev = id ? await getEnriched(id) : null;
  if (prev && prev.status !== "Confirmed") {
    throw new AppError(`A ${prev.status.toLowerCase()} reservation can't be edited.`, 400);
  }
  const { input, startsAt, endsAt } = await validate(body, prev, settings);
  const outletSettings = settingsFor(settings, input.outletId);
  const blockFrom = new Date(startsAt.getTime() - outletSettings.bufferBeforeMin * MINUTE);

  const conflicts = await findConflicts({
    outletId: input.outletId,
    tableNos: reservationTableNos(input.tableNo),
    from: blockFrom.toISOString(),
    to: endsAt.toISOString(),
    excludeId: id ?? undefined,
    settings,
  });
  if (conflicts.length && body.override !== true) throw new ConflictError(conflictMessage(conflicts));

  const payload: Row = {
    ...input,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    updatedAt: nowIso(),
  };
  const row = id
    ? await fbModel.update<Row>(T.reservations, id, payload)
    : await fbModel.create<Row>(T.reservations, {
        ...payload,
        id: fbModel.newId(),
        resNo: text(body.resNo) || fbModel.newCode("TR"),
        status: "Confirmed",
      });
  return enrich(row, outletSettings);
}

async function setStatus(id: string, patch: Row) {
  const [row, settings] = await Promise.all([
    fbModel.update<Row>(T.reservations, id, { ...patch, updatedAt: nowIso() }),
    loadSettings(),
  ]);
  return enrich(row, settingsFor(settings, row.outletId));
}

// ── Sweep: auto No Show and auto Completed ───────────────────────────────────

let lastSweep = 0;
let sweeping: Promise<{ noShows: number; completed: number }> | null = null;

async function runSweep() {
  const [settings, rows] = await Promise.all([loadSettings(), listByStatus(["Confirmed", "Seated"])]);
  const now = Date.now();
  let noShows = 0;
  let completed = 0;

  for (const raw of rows) {
    const r = enrich(raw, settingsFor(settings, raw.outletId), now);
    if (r.phase === "overdue") {
      await fbModel.update(T.reservations, r.id, {
        status: "No Show",
        noShowAt: nowIso(),
        statusNote: `Auto: guest did not arrive within the ${r.gracePeriodMin}-minute grace period`,
        updatedAt: nowIso(),
      });
      noShows += 1;
    } else if (r.status === "Seated" && r.sessionId) {
      const session = await fbModel.get<Row>(T.tableSessions, r.sessionId);
      if (!session || String(session.status ?? "").toUpperCase() !== "OPEN") {
        await fbModel.update(T.reservations, r.id, {
          status: "Completed",
          completedAt: session?.closedAt ? String(session.closedAt) : nowIso(),
          updatedAt: nowIso(),
        });
        completed += 1;
      }
    }
  }
  return { noShows, completed };
}

// ── Public API ───────────────────────────────────────────────────────────────

export const TableReservationService = {
  /** Throttled unless forced; safe to call before every floor or list read. */
  async sweep(options?: { force?: boolean }) {
    if (!options?.force && Date.now() - lastSweep < 30_000) return { noShows: 0, completed: 0 };
    if (sweeping) return sweeping;
    lastSweep = Date.now();
    sweeping = runSweep().finally(() => {
      sweeping = null;
    });
    return sweeping;
  },

  async list(query: { date?: string; outletId?: string; status?: string }) {
    await this.sweep().catch((e) => console.warn("[reservations] sweep failed:", e));
    const [settings, rows] = await Promise.all([
      loadSettings(),
      fbModel.list<Row>(T.reservations, {
        filters: {
          ...(query.outletId ? { outlet_id: query.outletId } : {}),
          ...(isIsoDate(query.date) ? { reservation_date: query.date } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
      }),
    ]);
    const now = Date.now();
    return rows
      .map((r) => enrich(r, settingsFor(settings, r.outletId), now))
      .sort((a, b) => {
        if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
        if (a.startsAt) return -1;
        if (b.startsAt) return 1;
        return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
      });
  },

  get: getEnriched,
  create: (body: Row) => save(null, body),
  update: (id: string, body: Row) => save(id, body),

  async remove(id: string) {
    const r = await getEnriched(id);
    if (r.status === "Seated") throw new AppError("This party is seated. Complete the reservation instead.", 400);
    await fbModel.remove(T.reservations, id);
  },

  async markNoShow(id: string) {
    const r = await getEnriched(id);
    if (r.status !== "Confirmed") {
      throw new AppError(`Only confirmed reservations can be marked as no-show (this one is ${r.status}).`, 400);
    }
    return setStatus(id, { status: "No Show", noShowAt: nowIso(), statusNote: "Marked by staff" });
  },

  async cancel(id: string, reason?: string) {
    const r = await getEnriched(id);
    if (r.status !== "Confirmed") throw new AppError(`Only confirmed reservations can be cancelled (this one is ${r.status}).`, 400);
    return setStatus(id, { status: "Cancelled", cancelledAt: nowIso(), statusNote: text(reason) || "Cancelled by staff" });
  },

  /** Guest arrived: open a dining session on the table and link it. */
  async seat(id: string, body: { tableNo?: string; override?: boolean; server?: string }) {
    const settings = await loadSettings();
    const r = await getEnriched(id);
    if (r.status !== "Confirmed" && r.status !== "No Show") {
      throw new AppError(`This reservation is ${r.status.toLowerCase()} and can't be seated.`, 400);
    }
    if (r.reservationDate && r.reservationDate > propertyToday()) {
      throw new AppError(`This booking is for ${r.reservationDate}. It can only be seated on that day.`, 400);
    }
    const tableNo = text(body.tableNo) || r.tableNos[0];
    if (!tableNo) throw new AppError("Choose a table to seat the guest at.", 400);

    const tables = await fbModel.list<Row>(T.liveTables, { filters: { outlet_id: r.outletId } });
    const table = tables.find((t) => norm(t.tableNo) === norm(tableNo));
    if (!table) throw new NotFoundError(`Table ${tableNo} was not found at this outlet`);

    const open = await fbModel.list<Row>(T.tableSessions, {
      filters: { live_table_id: String(table.id), status: "OPEN" },
      limit: 1,
    });
    if (open[0]) {
      throw new AppError(
        `Table ${tableNo} is occupied by ${text(open[0].guestName) || "another party"}. Seat the guest at a free table.`,
        400,
      );
    }

    const now = new Date();
    const others = (
      await findConflicts({
        outletId: r.outletId,
        tableNos: [tableNo],
        from: now.toISOString(),
        to: new Date(now.getTime() + r.durationMin * MINUTE).toISOString(),
        excludeId: r.id,
        settings,
      })
    ).filter((c) => c.status === "Seated" || isBlockingPhase(c.phase));
    if (others.length && body.override !== true) throw new ConflictError(conflictMessage(others));

    const session = await fbModel.create<Row>(T.tableSessions, {
      id: fbModel.newId(),
      liveTableId: String(table.id),
      outletId: r.outletId,
      guestName: r.guest || "Reservation",
      reservationId: r.id,
      pax: r.covers > 0 ? r.covers : 2,
      server: text(body.server),
      status: "OPEN",
      openedAt: now.toISOString(),
    });

    try {
      const updated = await setStatus(id, {
        status: "Seated",
        seatedAt: now.toISOString(),
        sessionId: String(session.id),
        tableNo: r.tableNos.length > 1 && norm(tableNo) === norm(r.tableNos[0]) ? r.tableNo : tableNo,
        statusNote: r.status === "No Show" ? "Arrived after being marked no-show" : "",
      });
      return { reservation: updated, session, liveTableId: String(table.id), tableNo: String(table.tableNo) };
    } catch (e) {
      await fbModel.remove(T.tableSessions, String(session.id)).catch(() => undefined);
      throw e;
    }
  },

  /** Party finished. Closes an empty session; a session with an open order must be settled first. */
  async complete(id: string) {
    const r = await getEnriched(id);
    if (r.status !== "Seated") throw new AppError("Only seated reservations can be completed.", 400);
    if (r.sessionId) {
      const session = await fbModel.get<Row>(T.tableSessions, r.sessionId);
      if (session && String(session.status ?? "").toUpperCase() === "OPEN") {
        const orders = await fbModel.list<Row>(T.orders, {
          filters: { session_id: r.sessionId, lifecycle_status: "OPEN" },
          limit: 1,
        });
        if (orders[0]) throw new AppError("This table still has an open order. Settle the bill to complete the reservation.", 400);
        await fbModel.update(T.tableSessions, r.sessionId, { status: "CLOSED", closedAt: nowIso() });
      }
    }
    return setStatus(id, { status: "Completed", completedAt: nowIso() });
  },

  async completeForSession(sessionId: string) {
    const rows = await fbModel.list<Row>(T.reservations, { filters: { session_id: sessionId, status: "Seated" } });
    await Promise.all(
      rows.map((r) => fbModel.update(T.reservations, String(r.id), { status: "Completed", completedAt: nowIso(), updatedAt: nowIso() })),
    );
  },

  /** A confirmed booking currently holding this table, if any. */
  async activeBlockingReservation(outletId: string, tableNo: string) {
    if (!outletId || !tableNo) return null;
    const settings = await loadSettings();
    const now = Date.now();
    const rows = await listByStatus(["Confirmed"], outletId);
    return (
      rows
        .map((r) => enrich(r, settingsFor(settings, r.outletId), now))
        .filter((r) => isBlockingPhase(r.phase) && r.tableNos.some((t) => norm(t) === norm(tableNo)))
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0] ?? null
    );
  },

  blockingMessage(r: EnrichedReservation, tableNo: string) {
    return `Table ${tableNo} is reserved for ${r.guest || "a guest"} at ${timeLabel(r.startsAt)} (${r.resNo}), held from ${timeLabel(r.blockFrom)}. Seat the reservation, or override from the floor plan.`;
  },

  /** Per-table reservation overlay for the floor plan. */
  async floorOverlay(outletId?: string) {
    await this.sweep().catch((e) => console.warn("[reservations] sweep failed:", e));
    const [settings, rows] = await Promise.all([loadSettings(), listByStatus(["Confirmed", "Seated"], outletId)]);
    const now = Date.now();
    const today = propertyToday();
    const byTable = new Map<string, EnrichedReservation[]>();
    for (const raw of rows) {
      const r = enrich(raw, settingsFor(settings, raw.outletId), now);
      for (const t of r.tableNos) {
        const key = tableKey(r.outletId, t);
        byTable.set(key, [...(byTable.get(key) ?? []), r]);
      }
    }

    return (table: Row): TableReservationOverlay | null => {
      const list = byTable.get(tableKey(table.outletId, table.tableNo)) ?? [];
      const openSessionId = table.openSessionId ? String(table.openSessionId) : null;
      const isBlank = table.displayState === "BLANK";
      const earliest = (xs: EnrichedReservation[]) =>
        xs.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0];

      const seated = list.find((r) => r.status === "Seated" && openSessionId && r.sessionId === openSessionId);
      const active = earliest(list.filter((r) => r.status === "Confirmed" && isBlockingPhase(r.phase)));
      const upcoming = earliest(
        list.filter((r) => r.status === "Confirmed" && r.phase === "upcoming" && r.reservationDate === today),
      );
      const pick = seated ?? active ?? upcoming;
      if (!pick) return null;
      return {
        id: pick.id,
        resNo: pick.resNo,
        guest: pick.guest,
        phone: pick.phone,
        time: pick.time,
        covers: pick.covers,
        startsAt: pick.startsAt,
        blockFrom: pick.blockFrom,
        graceEndsAt: pick.graceEndsAt,
        endsAt: pick.endsAt,
        phase: pick.phase,
        conflict: pick === active && !isBlank,
      };
    };
  },

  // ── Settings ──
  async getSettings() {
    const index = await loadSettings();
    return { global: index.global, outlets: [...index.outlets.values()] };
  },

  async saveSettings(scopeKey: string, body: Row) {
    const key = text(scopeKey) || GLOBAL;
    const details: { path: string; message: string }[] = [];
    const values: Record<string, number> = {};
    for (const [field, [min, max]] of Object.entries(LIMITS)) {
      const v = Math.floor(num(body[field], Number.NaN));
      if (!Number.isFinite(v) || v < min || v > max) {
        details.push({ path: field, message: `${field} must be between ${min} and ${max} minutes` });
      } else {
        values[field] = v;
      }
    }
    if (details.length) throw new ValidationError(details.map((d) => d.message).join("; "), details);
    const { error } = await supabase.from(SETTINGS_TABLE).upsert(
      {
        scope_key: key,
        buffer_before_min: values.bufferBeforeMin,
        grace_period_min: values.gracePeriodMin,
        default_duration_min: values.defaultDurationMin,
        updated_at: nowIso(),
      },
      { onConflict: "scope_key" },
    );
    if (error) throwIfRlsError(error.message);
    lastSweep = 0;
    return this.getSettings();
  },

  async deleteSettings(scopeKey: string) {
    if (scopeKey === GLOBAL) throw new AppError("The global defaults can't be removed.", 400);
    const { error } = await supabase.from(SETTINGS_TABLE).delete().eq("scope_key", scopeKey);
    if (error) throwIfRlsError(error.message);
    return this.getSettings();
  },

  startSweeper(intervalMs = 60_000) {
    const timer = setInterval(() => {
      this.sweep({ force: true })
        .then(({ noShows, completed }) => {
          if (noShows || completed) console.log(`[reservations] auto no-show: ${noShows}, completed: ${completed}`);
        })
        .catch((e) => console.warn("[reservations] sweep failed:", e));
    }, intervalMs);
    timer.unref?.();
  },
};

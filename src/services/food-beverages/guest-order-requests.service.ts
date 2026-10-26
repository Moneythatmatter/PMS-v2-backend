import { AppError, NotFoundError } from "../../errors/index.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { ReservationService } from "../front-office/reservation.service.js";
import {
  CLOSED_OUTLET,
  cleanText,
  loadGuestMenu,
  priceGuestLines,
  scopedTokenMatches,
  signScopedToken,
  type GuestPricedLine,
} from "./guest-menu.js";
import { PosService } from "./pos.service.js";

type Row = Record<string, unknown>;

const TABLE = "fb_guest_order_requests";
const MAX_PENDING_PER_TARGET = 5;

export type GuestOrderRequestStatus = "Pending" | "Accepted" | "Rejected" | "Cancelled";
export type GuestOrderRequestSource = "Table" | "Room";

export type GuestOrderRequest = {
  id: string;
  requestNo: string;
  outletId: string | null;
  outletName: string | null;
  source: GuestOrderRequestSource;
  liveTableId: string | null;
  tableNo: string | null;
  roomId: string | null;
  roomNo: string | null;
  reservationId: string | null;
  guestId: string | null;
  guestNo: string | null;
  guestName: string | null;
  guestPhone: string | null;
  pax: number | null;
  lines: GuestPricedLine[];
  instructions: string | null;
  subtotal: number;
  status: GuestOrderRequestStatus;
  orderId: string | null;
  orderNo: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
};

function mapDbError(message: string): never {
  if (/(source|room_id|room_no|reservation_id|guest_id|guest_no|target_check|live_table_id)/i.test(message) &&
      /(column|schema cache|could not find|not-null|violates)/i.test(message)) {
    throw new AppError(
      "Guest order requests table needs the room update. Run backend/sql/fb-guest-order-requests-room.sql in Supabase.",
      500,
    );
  }
  if (/fb_guest_order_requests/i.test(message) && /(does not exist|schema cache|could not find)/i.test(message)) {
    throw new AppError(
      "Guest order requests table is missing. Run backend/sql/fb-guest-order-requests.sql in Supabase.",
      500,
    );
  }
  throw new AppError(message, 500);
}

async function assertPendingCapacity(column: "live_table_id" | "room_id", value: string, message: string) {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .eq("status", "Pending");
  if (error) mapDbError(error.message);
  if ((count ?? 0) >= MAX_PENDING_PER_TARGET) throw new AppError(message, 429);
}

async function insertRequest(row: Row) {
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) mapDbError(error.message);
  const created = toCamel<GuestOrderRequest>(data);
  return { id: created.id, requestNo: created.requestNo, subtotal: Number(created.subtotal) };
}

export function signTableToken(tableId: string) {
  return signScopedToken("table", tableId);
}

async function resolveTable(tableId: string, token: string) {
  const id = String(tableId ?? "").trim();
  if (!id || !scopedTokenMatches("table", id, token)) {
    throw new AppError("This QR code is not valid. Please ask the staff for help.", 403, "INVALID_QR");
  }
  const table = await fbModel.get<Row>(fbModel.tables.liveTables, id);
  if (!table) throw new NotFoundError("Table not found");
  const outletId = table.outletId ? String(table.outletId) : null;
  const outlet = outletId ? await fbModel.get<Row>(fbModel.tables.outlets, outletId).catch(() => null) : null;
  return {
    table,
    tableId: id,
    tableNo: String(table.tableNo ?? id),
    outletId,
    outletName: outlet?.name ? String(outlet.name) : null,
    outletActive: !outlet || !CLOSED_OUTLET.test(String(outlet.status ?? "")),
  };
}

const lineTotal = (lines: GuestPricedLine[]) =>
  Math.round(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100;

async function getRequest(id: string): Promise<GuestOrderRequest> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) mapDbError(error.message);
  if (!data) throw new NotFoundError("Guest order request not found");
  return toCamel<GuestOrderRequest>(data);
}

/** Atomically move a Pending request to a new status; returns null if someone else already handled it. */
async function transitionFromPending(id: string, patch: Row) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "Pending")
    .select()
    .maybeSingle();
  if (error) mapDbError(error.message);
  return data ? toCamel<GuestOrderRequest>(data) : null;
}

export const GuestOrderRequestService = {
  signTableToken,

  async qrTokens() {
    const tables = await fbModel.list<Row>(fbModel.tables.liveTables);
    return tables.map((t) => ({
      tableId: String(t.id),
      tableNo: String(t.tableNo ?? t.id),
      outletId: t.outletId ? String(t.outletId) : null,
      token: signTableToken(String(t.id)),
    }));
  },

  /* ---------- Public (guest) ---------- */

  async context(tableId: string, token: string) {
    const ctx = await resolveTable(tableId, token);
    return {
      tableNo: ctx.tableNo,
      section: ctx.table.section ? String(ctx.table.section) : null,
      outletName: ctx.outletName,
      accepting: ctx.outletActive,
    };
  },

  async menu(tableId: string, token: string) {
    await resolveTable(tableId, token);
    return loadGuestMenu();
  },

  async submit(
    tableId: string,
    token: string,
    input: { lines?: unknown; guestName?: string; guestPhone?: string; pax?: number; instructions?: string },
  ) {
    const ctx = await resolveTable(tableId, token);
    if (!ctx.outletActive) throw new AppError("This outlet is not taking orders right now.", 409);

    await assertPendingCapacity(
      "live_table_id",
      ctx.tableId,
      "This table already has requests waiting for staff. Please wait a moment.",
    );

    const lines = await priceGuestLines(input.lines);
    const pax = Math.floor(Number(input.pax) || 0);
    return insertRequest({
      request_no: fbModel.newCode("GOR"),
      source: "Table",
      outlet_id: ctx.outletId,
      outlet_name: ctx.outletName,
      live_table_id: ctx.tableId,
      table_no: ctx.tableNo,
      guest_name: cleanText(input.guestName).slice(0, 80) || null,
      guest_phone: cleanText(input.guestPhone).slice(0, 20) || null,
      pax: pax > 0 && pax <= 50 ? pax : null,
      lines,
      instructions: cleanText(input.instructions) || null,
      subtotal: lineTotal(lines),
      status: "Pending",
    });
  },

  /** Room QR food order — caller has already verified the room token and the in-house stay. */
  async submitRoom(input: {
    roomId: string;
    roomNo: string;
    outletId: string;
    outletName: string | null;
    reservationId: string;
    guestId: string | null;
    guestNo: string | null;
    guestName: string | null;
    guestPhone: string | null;
    lines: unknown;
    instructions?: string;
  }) {
    await assertPendingCapacity(
      "room_id",
      input.roomId,
      "You already have orders waiting for confirmation. Please wait a moment.",
    );
    const lines = await priceGuestLines(input.lines);
    return insertRequest({
      request_no: fbModel.newCode("GOR"),
      source: "Room",
      outlet_id: input.outletId,
      outlet_name: input.outletName,
      room_id: input.roomId,
      room_no: input.roomNo,
      reservation_id: input.reservationId,
      guest_id: input.guestId,
      guest_no: input.guestNo,
      guest_name: input.guestName,
      guest_phone: input.guestPhone,
      lines,
      instructions: cleanText(input.instructions) || null,
      subtotal: lineTotal(lines),
      status: "Pending",
    });
  },

  async listForReservation(reservationId: string) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("reservation_id", reservationId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) mapDbError(error.message);
    return toCamel<GuestOrderRequest[]>(data ?? []);
  },

  async statuses(tableId: string, token: string, ids: string[]) {
    const ctx = await resolveTable(tableId, token);
    const wanted = ids.map((i) => i.trim()).filter(Boolean).slice(0, 20);
    if (!wanted.length) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, request_no, status, subtotal, order_no, reject_reason, created_at, lines")
      .eq("live_table_id", ctx.tableId)
      .in("id", wanted)
      .order("created_at", { ascending: false });
    if (error) mapDbError(error.message);
    return toCamel<
      Pick<
        GuestOrderRequest,
        "id" | "requestNo" | "status" | "subtotal" | "orderNo" | "rejectReason" | "createdAt" | "lines"
      >[]
    >(data ?? []);
  },

  /* ---------- Staff ---------- */

  async list(filters: { status?: string; outletId?: string; source?: string }) {
    let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false }).limit(200);
    if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.source === "Table" || filters.source === "Room") query = query.eq("source", filters.source);
    if (filters.outletId) query = query.eq("outlet_id", filters.outletId);
    const { data, error } = await query;
    if (error) mapDbError(error.message);
    return toCamel<GuestOrderRequest[]>(data ?? []);
  },

  async pendingCount(outletId?: string) {
    let query = supabase.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "Pending");
    if (outletId) query = query.eq("outlet_id", outletId);
    const { count, error } = await query;
    if (error) mapDbError(error.message);
    return { pending: count ?? 0 };
  },

  /** Staff converts a reviewed request into a real dine-in order + KOT on that table. */
  async approve(id: string, input: { lines?: unknown; instructions?: string; actor?: string }) {
    const request = await getRequest(id);
    if (request.status !== "Pending") throw new AppError(`This request is already ${request.status.toLowerCase()}.`, 409);
    if (!request.outletId) throw new AppError("This request has no outlet linked to it.", 400);
    if (request.source === "Room") {
      const stay = request.roomId ? await ReservationService.findCurrentForRoom(request.roomId).catch(() => null) : null;
      if (!stay || (request.reservationId && stay.id !== request.reservationId)) {
        throw new AppError(
          `The guest in Room ${request.roomNo ?? ""} is no longer checked in. Reject this request instead.`,
          409,
        );
      }
    }

    const lines = await priceGuestLines(input.lines ?? request.lines);
    const instructions =
      input.instructions !== undefined ? cleanText(input.instructions) : (request.instructions ?? "");
    const actor = cleanText(input.actor) || "Staff";

    const claimed = await transitionFromPending(id, {
      status: "Accepted",
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
      lines,
      instructions: instructions || null,
      subtotal: lineTotal(lines),
    });
    if (!claimed) throw new AppError("Another staff member already handled this request.", 409);

    try {
      const kotLines = lines.map((l, index) => ({
        ...l,
        ...(index === 0 && instructions ? { note: `Guest QR: ${instructions}` } : {}),
      }));
      const result =
        request.source === "Room"
          ? await PosService.sendKot({
              outletId: request.outletId,
              type: "Room Service",
              ref: request.roomNo ?? "",
              guest: request.guestName || "In-house Guest",
              ...(request.guestId ? { guestId: request.guestId } : {}),
              ...(request.guestNo ? { guestNo: request.guestNo } : {}),
              ...(request.reservationId ? { reservationId: request.reservationId } : {}),
              server: actor,
              lines: kotLines,
            })
          : await PosService.sendKot({
              outletId: request.outletId,
              type: "Dine In",
              ...(request.liveTableId ? { liveTableId: request.liveTableId } : {}),
              ref: request.tableNo ?? "",
              ...(request.guestName ? { guest: request.guestName } : {}),
              ...(request.pax ? { pax: request.pax } : {}),
              server: actor,
              lines: kotLines,
            });
      const order = (result as { order?: Row }).order ?? {};
      const { data, error } = await supabase
        .from(TABLE)
        .update({ order_id: order.id ?? null, order_no: order.orderNo ?? order.id ?? null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) mapDbError(error.message);
      return toCamel<GuestOrderRequest>(data);
    } catch (e) {
      await supabase
        .from(TABLE)
        .update({ status: "Pending", reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      throw e;
    }
  },

  async reject(id: string, input: { reason?: string; actor?: string }) {
    const request = await getRequest(id);
    if (request.status !== "Pending") throw new AppError(`This request is already ${request.status.toLowerCase()}.`, 409);
    const updated = await transitionFromPending(id, {
      status: "Rejected",
      reviewed_by: cleanText(input.actor) || "Staff",
      reviewed_at: new Date().toISOString(),
      reject_reason: cleanText(input.reason) || null,
    });
    if (!updated) throw new AppError("Another staff member already handled this request.", 409);
    return updated;
  },
};

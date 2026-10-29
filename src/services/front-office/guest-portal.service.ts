import { ReservationStatus } from "../../constants/front-office.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { supabase } from "../../utils/supabase.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { runWithRequestStore } from "../../utils/request-context.js";
import {
  CLOSED_OUTLET,
  cleanText,
  loadGuestMenu,
  scopedTokenMatches,
  signScopedToken,
} from "../food-beverages/guest-menu.js";
import { GuestOrderRequestService } from "../food-beverages/guest-order-requests.service.js";
import { GuestRequestService } from "../housekeeping/guest-request.service.js";
import { ReservationService } from "./reservation.service.js";

type Row = Record<string, unknown>;

export function signRoomToken(roomId: string): string {
  return signScopedToken("room", roomId);
}

function tokenMatches(roomId: string, token: string): boolean {
  return scopedTokenMatches("room", roomId, token);
}

type RoomContext = {
  room: Row;
  roomId: string;
  roomNo: string;
  propertyId: string | undefined;
};

async function resolveRoom(roomId: string, token: string): Promise<RoomContext> {
  const id = String(roomId ?? "").trim();
  if (!id || !tokenMatches(id, token)) {
    throw new AppError("This QR code is not valid. Please contact the front desk.", 403, "INVALID_QR");
  }
  const room = await foModel.get<Row>(foModel.tables.rooms, id);
  if (!room || room.isActive === false) throw new NotFoundError("Room not found");
  return {
    room,
    roomId: id,
    roomNo: String(room.roomNo ?? id),
    propertyId: room.propertyId ? String(room.propertyId) : undefined,
  };
}

async function inHouseReservation(roomId: string) {
  const current = await ReservationService.findCurrentForRoom(roomId);
  if (
    current &&
    (current.status === ReservationStatus.CHECKED_IN || current.status === ReservationStatus.IN_HOUSE)
  ) {
    return current;
  }
  return null;
}

async function requireInHouse(roomId: string) {
  const stay = await inHouseReservation(roomId);
  if (!stay) {
    throw new AppError(
      "This room has no checked-in guest. Please contact the front desk for assistance.",
      409,
      "ROOM_NOT_OCCUPIED",
    );
  }
  return stay;
}

/** Run with the room's property as request context so property-scoped tables resolve correctly. */
async function withRoom<T>(roomId: string, token: string, fn: (ctx: RoomContext) => Promise<T>): Promise<T> {
  const ctx = await resolveRoom(roomId, token);
  return runWithRequestStore({ propertyId: ctx.propertyId }, () => fn(ctx));
}

function guestRequestStatusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Awaiting confirmation";
    case "ASSIGNED":
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Declined";
    default:
      return status;
  }
}

const LAUNDRY_SERVICES = ["Wash & Iron", "Dry Clean", "Iron Only"];
const CLEANING_PREFIX = "Room cleaning requested via guest QR · Preferred: ";
const LAUNDRY_PREFIX = "Laundry pickup requested via guest QR · Service: ";

function cleaningDescription(input: { preferredTime?: string; notes?: string }) {
  const preferred = cleanText(input.preferredTime) || "As soon as possible";
  const notes = cleanText(input.notes);
  return {
    description: `${CLEANING_PREFIX}${preferred}${notes ? ` · ${notes}` : ""}`,
    priority: "MEDIUM",
  };
}

function laundryDescription(input: { serviceType?: string; urgency?: string; notes?: string }) {
  const serviceType = LAUNDRY_SERVICES.includes(String(input.serviceType)) ? String(input.serviceType) : "Wash & Iron";
  const urgency = String(input.urgency) === "Express" ? "Express" : "Normal";
  const notes = cleanText(input.notes);
  return {
    description: `${LAUNDRY_PREFIX}${serviceType} · Turnaround: ${urgency}${notes ? ` · ${notes}` : ""}`,
    priority: urgency === "Express" ? "HIGH" : "MEDIUM",
  };
}

/** Read the guest's choices back out of a description written by the builders above. */
function parseCleaning(description: string) {
  const m = description.startsWith(CLEANING_PREFIX)
    ? /^(.+?)(?: · ([\s\S]*))?$/.exec(description.slice(CLEANING_PREFIX.length))
    : null;
  return { preferredTime: m?.[1] ?? "As soon as possible", notes: m?.[2] ?? "" };
}

function parseLaundry(description: string) {
  const m = description.startsWith(LAUNDRY_PREFIX)
    ? /^(.+?) · Turnaround: (Normal|Express)(?: · ([\s\S]*))?$/.exec(description.slice(LAUNDRY_PREFIX.length))
    : null;
  return { serviceType: m?.[1] ?? "Wash & Iron", urgency: m?.[2] ?? "Normal", notes: m?.[3] ?? "" };
}

async function updatePendingHkRequest(
  ctx: RoomContext,
  bookingId: string,
  requestId: string,
  requestType: "CLEANING" | "LAUNDRY",
  patch: { description: string; priority: string },
) {
  const existing = await hkModel.get<Row>(hkModel.tables.guestRequests, requestId);
  if (
    !existing ||
    String(existing.roomId ?? "") !== ctx.roomId ||
    String(existing.bookingId ?? "") !== bookingId ||
    String(existing.requestType ?? "") !== requestType
  ) {
    throw new NotFoundError("Request not found");
  }
  const locked = new AppError("Housekeeping has already picked up this request, so it can no longer be changed.", 409);
  if (String(existing.status) !== "PENDING") throw locked;
  const { data, error } = await supabase
    .from(hkModel.tables.guestRequests)
    .update({ description: patch.description, priority: patch.priority, updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "PENDING")
    .select("id, request_number")
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw locked;
  return { requestId: String(data.id), requestNumber: String(data.request_number ?? "") };
}

function firstName(name: string | undefined | null): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

async function roomServiceOutlet(): Promise<Row | null> {
  const outlets = await fbModel.list<Row>(fbModel.tables.outlets);
  const active = outlets.filter((o) => !CLOSED_OUTLET.test(String(o.status ?? "")));
  return (
    active.find((o) => /room/i.test(`${o.type ?? ""} ${o.name ?? ""}`)) ??
    active[0] ??
    null
  );
}

export const GuestPortalService = {
  signRoomToken,

  async qrTokens() {
    const rooms = await foModel.list<Row>(foModel.tables.rooms);
    return rooms.map((r) => ({
      roomId: String(r.id),
      roomNo: String(r.roomNo ?? r.id),
      token: signRoomToken(String(r.id)),
    }));
  },

  async context(roomId: string, token: string) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await inHouseReservation(ctx.roomId);
      const [requests, laundry, orders, foodRequests] = await Promise.all([
        stay
          ? GuestRequestService.list({ roomId: ctx.roomId, bookingId: stay.id }).catch(() => [])
          : Promise.resolve([]),
        stay
          ? hkModel
              .list<Row>(hkModel.tables.laundryJobs, { filters: { booking_id: stay.id }, orderBy: "created_at", ascending: false, limit: 5 })
              .catch(() => [] as Row[])
          : Promise.resolve([] as Row[]),
        stay
          ? fbModel
              .list<Row>(fbModel.tables.orders, { filters: { reservation_id: stay.id }, orderBy: "created_at", ascending: false, limit: 5 })
              .catch(() => [] as Row[])
          : Promise.resolve([] as Row[]),
        stay
          ? GuestOrderRequestService.listForReservation(stay.id).catch(() => [])
          : Promise.resolve([]),
      ]);
      const ordersById = new Map(orders.map((o) => [String(o.id), o]));
      const requestOrderIds = new Set(foodRequests.map((r) => r.orderId).filter(Boolean));

      return {
        roomNo: ctx.roomNo,
        roomType: String(ctx.room.roomType ?? ""),
        occupied: Boolean(stay),
        guestFirstName: stay ? firstName(stay.guestName) : null,
        checkOut: stay?.checkOut ?? null,
        recent: [
          ...foodRequests.map((r) => ({
            kind: "food" as const,
            id: r.id,
            label: `Food order · ${r.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}`,
            status:
              r.status === "Pending"
                ? "Awaiting confirmation"
                : r.status === "Accepted"
                  ? String(ordersById.get(String(r.orderId))?.status ?? "Confirmed")
                  : r.status === "Rejected"
                    ? `Declined${r.rejectReason ? ` · ${r.rejectReason}` : ""}`
                    : r.status,
            at: r.createdAt,
            editable: r.status === "Pending",
            edit:
              r.status === "Pending"
                ? {
                    lines: r.lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
                    instructions: r.instructions ?? "",
                  }
                : undefined,
          })),
          ...orders
            .filter((o) => !requestOrderIds.has(String(o.id)))
            .map((o) => ({
              kind: "food" as const,
              id: String(o.id),
              label: `Food order ${o.orderNo ?? ""}`.trim(),
              status: String(o.status ?? "Pending"),
              at: String(o.createdAt ?? ""),
              editable: false,
            })),
          ...requests
            .filter((r) => {
              const type = String(r.requestType ?? "");
              if (type === "CLEANING") return true;
              // Converted laundry requests are represented by their laundry job below.
              return type === "LAUNDRY" && r.status !== "COMPLETED";
            })
            .slice(0, 6)
            .map((r) => ({
              kind: String(r.requestType) === "LAUNDRY" ? ("laundry" as const) : ("cleaning" as const),
              id: String(r.id),
              label: `${String(r.requestType) === "LAUNDRY" ? "Laundry pickup" : "Room cleaning"} ${r.requestNumber ?? ""}`.trim(),
              status: guestRequestStatusLabel(String(r.status ?? "PENDING")),
              at: String(r.requestedAt ?? r.createdAt ?? ""),
              editable: String(r.status ?? "PENDING") === "PENDING",
              edit:
                String(r.status ?? "PENDING") === "PENDING"
                  ? String(r.requestType) === "LAUNDRY"
                    ? parseLaundry(String(r.description ?? ""))
                    : parseCleaning(String(r.description ?? ""))
                  : undefined,
            })),
          ...laundry.map((j) => ({
            kind: "laundry" as const,
            id: String(j.id),
            label: "Laundry pickup",
            status: String(j.status ?? "Collection"),
            at: String(j.createdAt ?? ""),
            editable: false,
          })),
        ]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 8),
      };
    });
  },

  async menu(roomId: string, token: string) {
    return withRoom(roomId, token, () => loadGuestMenu());
  },

  async orderFood(
    roomId: string,
    token: string,
    input: { lines?: { menuItemId?: string; qty?: number }[]; instructions?: string },
  ) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      const outlet = await roomServiceOutlet();
      if (!outlet) throw new AppError("In-room dining is not available right now", 503);
      return GuestOrderRequestService.submitRoom({
        roomId: ctx.roomId,
        roomNo: ctx.roomNo,
        outletId: String(outlet.id),
        outletName: outlet.name ? String(outlet.name) : null,
        reservationId: stay.id,
        guestId: stay.guestId ?? null,
        guestNo: stay.guestNo ?? null,
        guestName: stay.guestName || null,
        guestPhone: stay.phone ?? null,
        lines: input.lines,
        instructions: input.instructions,
      });
    });
  },

  async requestCleaning(roomId: string, token: string, input: { preferredTime?: string; notes?: string }) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      const request = await GuestRequestService.create({
        roomId: ctx.roomId,
        bookingId: stay.id,
        requestType: "CLEANING",
        ...cleaningDescription(input),
        createdBy: "Guest Portal",
      });
      return { requestId: String(request.id), requestNumber: String(request.requestNumber ?? "") };
    });
  },

  async requestLaundry(
    roomId: string,
    token: string,
    input: { serviceType?: string; urgency?: string; notes?: string },
  ) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      const request = await GuestRequestService.create({
        roomId: ctx.roomId,
        bookingId: stay.id,
        requestType: "LAUNDRY",
        ...laundryDescription(input),
        createdBy: "Guest Portal",
      });
      return { requestId: String(request.id), requestNumber: String(request.requestNumber ?? "") };
    });
  },

  async updateFoodOrder(
    roomId: string,
    token: string,
    requestId: string,
    input: { lines?: { menuItemId?: string; qty?: number }[]; instructions?: string },
  ) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      return GuestOrderRequestService.updateRoom(requestId, { roomId: ctx.roomId, reservationId: stay.id }, input);
    });
  },

  async updateCleaning(roomId: string, token: string, requestId: string, input: { preferredTime?: string; notes?: string }) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      return updatePendingHkRequest(ctx, stay.id, requestId, "CLEANING", cleaningDescription(input));
    });
  },

  async updateLaundry(
    roomId: string,
    token: string,
    requestId: string,
    input: { serviceType?: string; urgency?: string; notes?: string },
  ) {
    return withRoom(roomId, token, async (ctx) => {
      const stay = await requireInHouse(ctx.roomId);
      return updatePendingHkRequest(ctx, stay.id, requestId, "LAUNDRY", laundryDescription(input));
    });
  },
};

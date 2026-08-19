import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import { ReservationStatus } from "../../constants/front-office.js";
import { ReservationService } from "../front-office/reservation.service.js";
import {
  enrichGuestRequest,
  enrichGuestRequests,
  persistGuestRequestRow,
  resolveGuestRequestAssignee,
  resolveGuestRequestAssigneeLabel,
  resolveGuestRequestId,
  resolveRoomIdForGuestRequest,
  sanitizeGuestRequestInput,
} from "./guest-request-enrich.js";
import {
  normalizeGuestRequestPriority,
  normalizeGuestRequestStatus,
  normalizeGuestRequestType,
  type GuestRequest,
  type GuestRequestStatus,
} from "../../types/housekeeping.js";

const ACTIVE_STATUSES: GuestRequestStatus[] = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
];

async function getRequestOrThrow(id: string): Promise<GuestRequest> {
  const row = await hkModel.get<GuestRequest>(hkModel.tables.guestRequests, id);
  if (!row) throw new NotFoundError("Guest request not found");
  return row;
}

async function appendHistory(entry: {
  user: string;
  category: string;
  action: string;
  room?: string;
  details: string;
}) {
  await hkModel.create(hkModel.tables.history, {
    id: hkModel.newId("H"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

export const GuestRequestService = {
  async list(filters: {
    status?: string;
    roomId?: string;
    bookingId?: string;
    requestType?: string;
  } = {}): Promise<GuestRequest[]> {
    const queryFilters: Record<string, string | undefined> = {};
    if (filters.status) {
      queryFilters.status = normalizeGuestRequestStatus(filters.status);
    }
    if (filters.requestType) {
      queryFilters.request_type = normalizeGuestRequestType(filters.requestType);
    }

    let rows = await hkModel.list<GuestRequest>(hkModel.tables.guestRequests, {
      filters: queryFilters,
      orderBy: "requested_at",
      ascending: false,
    });

    if (filters.roomId) {
      const roomId =
        (await resolveRoomIdForGuestRequest(filters.roomId)) ?? filters.roomId;
      rows = rows.filter((r) => String(r.roomId) === roomId);
    }
    if (filters.bookingId) {
      rows = rows.filter((r) => String(r.bookingId) === filters.bookingId);
    }

    return enrichGuestRequests(rows);
  },

  async get(id: string): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    return enrichGuestRequest(await getRequestOrThrow(resolved));
  },

  async create(input: Record<string, unknown>): Promise<GuestRequest> {
    const body = sanitizeGuestRequestInput(input);
    const roomKey = String(body.roomId ?? "").trim();
    if (!roomKey) throw new AppError("roomId is required", 400);

    const roomId = (await resolveRoomIdForGuestRequest(roomKey)) ?? roomKey;
    body.roomId = roomId;

    const description = String(body.description ?? "").trim();
    if (!description) throw new AppError("description is required", 400);
    body.description = description;

    if (!body.requestType) {
      body.requestType = normalizeGuestRequestType(description);
    } else {
      body.requestType = normalizeGuestRequestType(body.requestType);
    }

    if (!body.priority) body.priority = "MEDIUM";
    body.priority = normalizeGuestRequestPriority(body.priority);

    const assignedToRaw = String(body.assignedTo ?? "").trim();
    const assigneeLabel =
      (await resolveGuestRequestAssigneeLabel(assignedToRaw)) || assignedToRaw;
    body.assignedTo = await resolveGuestRequestAssignee(assignedToRaw);
    if (body.createdBy != null) {
      body.createdBy = await resolveGuestRequestAssignee(body.createdBy);
    }

    if (!body.status) {
      body.status = body.assignedTo ? "IN_PROGRESS" : "PENDING";
    }
    body.status = normalizeGuestRequestStatus(body.status);

    if (body.bookingId === "") body.bookingId = null;
    if (!body.bookingId) {
      const current = await ReservationService.findCurrentForRoom(roomId);
      if (
        current &&
        (current.status === ReservationStatus.CHECKED_IN ||
          current.status === ReservationStatus.IN_HOUSE)
      ) {
        body.bookingId = current.id;
      }
    }
    if (!body.id) body.id = hkModel.newId();
    if (!body.requestedAt) body.requestedAt = new Date().toISOString();

    const saved = await persistGuestRequestRow(body, { mode: "create" }, assigneeLabel);
    const row = await enrichGuestRequest({
      ...saved,
      assignedTo:
        saved.assignedTo ??
        (typeof body.assignedTo === "string" ? body.assignedTo : null) ??
        assigneeLabel,
      assignedToName: assigneeLabel || undefined,
    });

    await appendHistory({
      user: String(body.createdBy ?? assignedToRaw ?? "Front Desk"),
      category: "Guest Services",
      action: "Request created",
      room: row.roomNo ?? roomId,
      details: `${row.requestNumber ?? row.id}: ${description}`,
    });

    return row;
  },

  async update(id: string, input: Record<string, unknown>): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    const existing = await getRequestOrThrow(resolved);

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      throw new ConflictError(`Cannot edit request in status ${existing.status}`);
    }

    const body = sanitizeGuestRequestInput(input);
    const patch: Record<string, unknown> = {};

    if (body.description != null) {
      const description = String(body.description).trim();
      if (!description) throw new AppError("description is required", 400);
      patch.description = description;
      patch.requestType = normalizeGuestRequestType(
        body.requestType ?? description,
      );
    } else if (body.requestType != null) {
      patch.requestType = normalizeGuestRequestType(body.requestType);
    }

    if (body.priority != null) {
      patch.priority = normalizeGuestRequestPriority(body.priority);
    }
    if (body.notes != null) {
      patch.notes = String(body.notes).trim() || null;
    }

    if (!Object.keys(patch).length) {
      throw new AppError("No valid fields to update", 400);
    }

    const saved = await hkModel.update<GuestRequest>(
      hkModel.tables.guestRequests,
      resolved,
      patch,
    );
    return enrichGuestRequest(saved);
  },

  async assign(id: string, assignedTo: string): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    const existing = await getRequestOrThrow(resolved);

    if (!ACTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictError(
        `Cannot assign request in status ${existing.status}`,
      );
    }

    const staff = assignedTo.trim();
    if (!staff) throw new AppError("assignedTo is required", 400);

    const resolvedStaff = await resolveGuestRequestAssignee(staff);
    const assigneeLabel = (await resolveGuestRequestAssigneeLabel(staff)) || staff;

    const saved = await persistGuestRequestRow(
      {
        status: "IN_PROGRESS",
        assignedTo: resolvedStaff,
      },
      { mode: "update", id: resolved },
      assigneeLabel,
    );
    const row = await enrichGuestRequest({
      ...saved,
      assignedTo: saved.assignedTo ?? resolvedStaff ?? assigneeLabel,
      assignedToName: assigneeLabel,
    });

    await appendHistory({
      user: staff,
      category: "Guest Services",
      action: "Request assigned",
      room: row.roomNo ?? existing.roomId,
      details: `${row.requestNumber ?? resolved} assigned to ${staff}`,
    });

    return row;
  },

  async start(id: string): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    const existing = await getRequestOrThrow(resolved);

    if (!["PENDING", "ASSIGNED"].includes(existing.status)) {
      throw new ConflictError(
        `Cannot start request in status ${existing.status}`,
      );
    }

    return enrichGuestRequest(
      await hkModel.update<GuestRequest>(hkModel.tables.guestRequests, resolved, {
        status: "IN_PROGRESS",
      }),
    );
  },

  async complete(id: string, notes?: string): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    const existing = await getRequestOrThrow(resolved);

    if (existing.status === "COMPLETED") {
      throw new ConflictError("Request is already completed");
    }
    if (existing.status === "CANCELLED") {
      throw new ConflictError("Cannot complete a cancelled request");
    }

    const now = new Date().toISOString();
    const row = await enrichGuestRequest(
      await hkModel.update<GuestRequest>(hkModel.tables.guestRequests, resolved, {
        status: "COMPLETED",
        completedAt: now,
        notes: notes ?? existing.notes,
      }),
    );

    await appendHistory({
      user: String(existing.assignedTo ?? "Housekeeper"),
      category: "Guest Services",
      action: "Request completed",
      room: row.roomNo ?? existing.roomId,
      details: `${row.requestNumber ?? resolved} completed`,
    });

    return row;
  },

  async cancel(id: string, notes?: string): Promise<GuestRequest> {
    const resolved = await resolveGuestRequestId(id);
    if (!resolved) throw new NotFoundError("Guest request not found");
    const existing = await getRequestOrThrow(resolved);

    if (existing.status === "COMPLETED") {
      throw new ConflictError("Cannot cancel a completed request");
    }

    return enrichGuestRequest(
      await hkModel.update<GuestRequest>(hkModel.tables.guestRequests, resolved, {
        status: "CANCELLED",
        notes: notes ?? existing.notes,
      }),
    );
  },
};

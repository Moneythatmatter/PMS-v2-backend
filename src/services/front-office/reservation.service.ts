import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import {
  ActivityType,
  FoChargeCategory,
  ReservationStatus,
  RoomStatus,
} from "../../constants/front-office.js";
import type {
  InHouseGuest,
  Reservation,
  ReservationGuestLink,
  SummaryCard,
} from "../../types/front-office.js";
import {
  AppError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from "../../errors/index.js";
import {
  formatDate,
  formatTime,
  isArrivingTodayReservation,
  timestamp,
  todayIso,
} from "../../utils/date.js";
import { FolioChargeService } from "../shared/folio-charge.service.js";
import { IdService } from "../shared/id.service.js";
import { ActivityService } from "../shared/activity.service.js";
import { TransactionService } from "../shared/transaction.service.js";
import { FolioService } from "../shared/folio.service.js";
import {
  enrichReservation,
  enrichReservations,
  displayRoomNo,
  isRealRoomRef,
  normalizeReservationRoomRef,
  normalizeReservationSourceRef,
  resolveRoomRef,
  sanitizeReservationInput,
} from "./reservation-enrich.js";
import { getRoomByRef, resolveRoomId } from "./room-resolver.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import type { Guest } from "../../types/front-office.js";
import {
  getReservationByKey,
} from "./reservation-lookup.js";
import { HkTaskService } from "../housekeeping/hk-task.service.js";

/** Stay dates are text columns; legacy rows hold en-IN labels like "27 Oct 2026". */
function toIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : todayIso(parsed);
}

function assertStayNotInPast(checkIn: unknown, checkOut: unknown): void {
  const today = todayIso();
  const inIso = toIsoDate(checkIn);
  const outIso = toIsoDate(checkOut);
  if (inIso && inIso < today) {
    throw new ValidationError("Check-in date cannot be in the past", [
      { path: "checkIn", message: "Check-in date cannot be in the past" },
    ]);
  }
  if (inIso && outIso && outIso <= inIso) {
    throw new ValidationError("Check-out must be after check-in", [
      { path: "checkOut", message: "Check-out must be after check-in" },
    ]);
  }
}

function nightsBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000));
}
const CHECK_IN_IDENTITY_FIELDS: [keyof Guest, string][] = [
  ["gender", "Gender"],
  ["dob", "Date of birth"],
  ["nationality", "Nationality"],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["pincode", "Pincode"],
  ["idType", "ID proof type"],
  ["idNumber", "ID number"],
];

/**
 * Server-side guard so no client can check a guest in without a linked guest
 * profile, an assigned room and the registration (identity) details.
 */
async function assertCheckInRequirements(
  existing: Reservation,
  extras: Record<string, unknown>,
  assignedRoom: string | null | undefined,
): Promise<void> {
  const text = (v: unknown) => String(v ?? "").trim();
  const missing: string[] = [];

  const room = assignedRoom || resolveRoomRef(existing);
  if (!room || !isRealRoomRef(room)) missing.push("Assigned room");

  const guestId = text(extras.guestId) || text(existing.guestId);
  let guest: Guest | null = null;
  if (guestId) {
    const { data, error } = await supabase
      .from(foModel.tables.guests)
      .select("*")
      .eq("id", guestId)
      .maybeSingle();
    if (error) throw new DatabaseError(error.message);
    guest = data ? toCamel<Guest>(data as Record<string, unknown>) : null;
  }

  if (!guest) {
    missing.push("Guest staying in the room (name, mobile and ID details)");
  } else {
    if (!text(guest.name)) missing.push("Guest name");
    if (text(guest.mobile).replace(/\D/g, "").length < 10) missing.push("Mobile");
    const reservation = existing as unknown as Record<string, unknown>;
    for (const [key, label] of CHECK_IN_IDENTITY_FIELDS) {
      const aliases = key === "idType" ? ["idType", "idProofType"] : [key];
      const value = aliases
        .map((k) => text(extras[k]) || text(reservation[k]))
        .find(Boolean) || text(guest[key]);
      if (!value) missing.push(label);
    }
  }

  if (missing.length) {
    throw new ValidationError(
      `Cannot check in — required details missing: ${missing.join(", ")}`,
      missing.map((m) => ({ path: "checkIn", message: `${m} is required` })),
    );
  }
}

async function ensureReservationFolio(
  reservation: Pick<Reservation, "id" | "guestId">,
): Promise<void> {
  try {
    await TransactionService.ensureFolioForBooking(
      reservation.id,
      reservation.guestId ?? null,
    );
  } catch {
    // Do not block reservation reads if folios schema is not applied yet
  }
}

async function getOrThrow(id: string): Promise<Reservation> {
  const row = await getReservationByKey(id);
  if (!row) throw new NotFoundError("Reservation not found");
  return enrichReservation(row);
}

function mapReservationRow(raw: unknown): Reservation {
  return toCamel<Reservation>(raw as Record<string, unknown>);
}

async function markRoomDirty(roomId: string): Promise<void> {
  const { error } = await supabase.rpc("hk_ensure_room_dirty", {
    p_room_id: roomId,
  });
  if (error) throw new DatabaseError(error.message);
}

/** FO room cards derive Reserved/Occupied from reservations; hk_rooms holds HK readiness only. */
async function reserveRoom(_roomRef: string) {
  /* no-op — reservation status is the source of truth */
}

async function occupyRoom(_roomRef: string) {
  /* no-op — checked-in reservation drives Occupied in FO views */
}

async function releaseRoom(
  roomRef: unknown,
  toStatus: string = RoomStatus.VACANT,
) {
  if (!isRealRoomRef(roomRef)) return;
  if (toStatus !== RoomStatus.DIRTY) return;
  const room = await getRoomByRef(String(roomRef).trim());
  if (!room?.id) return;
  await markRoomDirty(room.id);
}

/**
 * ReservationService — business workflows for FO reservations.
 * Check-in / check-out prefer transactional Postgres RPCs when available.
 */
export const ReservationService = {
  async list(status?: string): Promise<Reservation[]> {
    const rows = await foModel.list<Reservation>(foModel.tables.reservations, {
      filters: status ? { status } : undefined,
      orderBy: "created_at",
      ascending: false,
    });
    return enrichReservations(rows);
  },

  async getById(id: string): Promise<Reservation> {
    const row = await getOrThrow(id);
    await ensureReservationFolio(row);
    return row;
  },

  async create(
    input: Partial<Reservation> & {
      externalReference?: string | null;
      paymentReference?: string | null;
    },
  ): Promise<Reservation> {
    const groupId = String(input.groupId ?? "").trim();
    const guestIdRaw = String(input.guestId ?? "").trim();

    // Individual bookings still require a guest; group children may be TBA (null guest).
    if (!groupId && !guestIdRaw) {
      throw new AppError("guestId is required — create or select a guest profile first");
    }

    const externalReference = String(
      input.externalReference ?? input.paymentReference ?? "",
    ).trim();
    const advancePaid = Number(input.advancePaid ?? 0);
    const totalAmount = Number(input.totalAmount ?? 0);

    if (advancePaid > 0 && !String(input.paymentMode ?? "").trim()) {
      throw new AppError("Payment method is required when advance amount is collected");
    }
    assertStayNotInPast(input.checkIn, input.checkOut);

    const body = sanitizeReservationInput(input) as Record<string, unknown>;
    delete body.externalReference;
    delete body.paymentReference;
    if (groupId) {
      body.groupId = groupId;
      if (!guestIdRaw) body.guestId = null;
      if (!body.bookingType) body.bookingType = "Group";
    }
    await normalizeReservationRoomRef(body);
    await normalizeReservationSourceRef(body);
    if (!body.id) body.id = IdService.generateReservation();
    if (!body.createdAt) body.createdAt = timestamp();
    if (!body.status) body.status = ReservationStatus.CONFIRMED;
    if (body.checkIn && isArrivingTodayReservation(body)) {
      body.arrivingToday = true;
    }

    const row = await foModel.create<Reservation>(
      foModel.tables.reservations,
      body as Record<string, unknown>,
    );

    const enriched = await enrichReservation(row);
    const roomRef = resolveRoomRef(enriched);

    if (roomRef && isRealRoomRef(roomRef)) {
      await reserveRoom(roomRef);
    }

    await ActivityService.log({
      type: ActivityType.RESERVATION_CREATED,
      message: `New reservation — ${enriched.guestName ?? (groupId ? "Unassigned" : "Guest")}, ${roomRef ?? "TBA"}`,
      guestId: guestIdRaw || undefined,
      room: roomRef,
      reservationId: String(body.id ?? ""),
    });

    const guestId = guestIdRaw || null;
    const folioId = await TransactionService.ensureFolioForBooking(
      enriched.id,
      guestId,
    );

    // Individual bookings: legacy subtotal seed. Group children: folio_charges own ROOM.
    if (!groupId && totalAmount > 0) {
      await foModel.update(foModel.tables.folios, folioId, {
        subtotal: totalAmount,
      });
    }

    if (advancePaid > 0) {
      await TransactionService.recordReservationAdvance({
        amount: advancePaid,
        bookingId: enriched.id,
        guestId,
        paymentMethod: String(input.paymentMode ?? body.paymentMode ?? "Cash"),
        externalReference: externalReference || null,
        notes: "Reservation advance payment",
      });
    }

    return enriched;
  },

  async update(id: string, input: Partial<Reservation>): Promise<Reservation> {
    const existing = await getOrThrow(id);
    const nextCheckIn = toIsoDate(input.checkIn);
    if (nextCheckIn && nextCheckIn !== toIsoDate(existing.checkIn)) {
      assertStayNotInPast(input.checkIn, input.checkOut ?? existing.checkOut);
    }
    const body = sanitizeReservationInput(input);
    delete body.id;
    await normalizeReservationRoomRef(body);
    await normalizeReservationSourceRef(body);

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      existing.id,
      body,
    );
    const enriched = await enrichReservation(row);

    const nextStatus = String(enriched.status ?? existing.status);
    const prevRoom = resolveRoomRef(existing);
    const nextRoom = resolveRoomRef(enriched);
    const prevRoomReal = prevRoom && isRealRoomRef(prevRoom) ? prevRoom : "";
    const nextRoomReal = nextRoom && isRealRoomRef(nextRoom) ? nextRoom : "";

    if (
      nextStatus === ReservationStatus.CANCELLED ||
      nextStatus === ReservationStatus.CHECKED_OUT ||
      nextStatus === ReservationStatus.NO_SHOW
    ) {
      if (prevRoomReal) await releaseRoom(prevRoomReal, RoomStatus.VACANT);
      return enriched;
    }

    if (prevRoomReal && prevRoomReal !== nextRoomReal) {
      await releaseRoom(prevRoomReal, RoomStatus.VACANT);
    }
    if (nextRoomReal) {
      if (
        nextStatus === ReservationStatus.CHECKED_IN ||
        nextStatus === ReservationStatus.IN_HOUSE
      ) {
        await occupyRoom(nextRoomReal);
      } else {
        await reserveRoom(nextRoomReal);
      }
    }

    return enriched;
  },

  async remove(id: string): Promise<{ id: string }> {
    const existing = await getOrThrow(id);
    await foModel.remove(foModel.tables.reservations, existing.id);
    const roomRef = resolveRoomRef(existing);
    if (roomRef && isRealRoomRef(roomRef)) {
      await releaseRoom(roomRef, RoomStatus.VACANT);
    }
    return { id: existing.id };
  },

  /**
   * Check-in (transactional via fo_check_in_reservation RPC when applied).
   * Fallback: sequential writes if RPC is not installed yet.
   */
  async checkIn(
    id: string,
    extras: Partial<Reservation> & {
      companionGuestIds?: string[];
    } = {},
  ): Promise<Reservation> {
    let existing = await getOrThrow(id);
    const reservationId = existing.id;

    const companionGuestIds = Array.isArray(extras.companionGuestIds)
      ? extras.companionGuestIds.map(String).filter(Boolean)
      : [];
    const { companionGuestIds: _cg, ...checkInExtras } = extras;

    if (existing.status === ReservationStatus.CHECKED_OUT) {
      throw new ConflictError("Cannot check in a checked-out reservation");
    }
    if (
      existing.status === ReservationStatus.CHECKED_IN ||
      existing.status === ReservationStatus.IN_HOUSE
    ) {
      throw new ConflictError("Guest is already checked in");
    }

    const assignedRoom = resolveRoomRef(checkInExtras);
    const existingRoom = resolveRoomRef(existing);
    if (
      assignedRoom &&
      isRealRoomRef(assignedRoom) &&
      assignedRoom !== existingRoom
    ) {
      const {
        status: _s,
        arrivingToday: _a,
        ...roomPatch
      } = sanitizeReservationInput(checkInExtras) as Record<string, unknown>;
      await normalizeReservationRoomRef(roomPatch);
      const updated = await foModel.update<Reservation>(
        foModel.tables.reservations,
        reservationId,
        roomPatch,
      );
      existing = await enrichReservation(updated);
    }

    const activityId = IdService.generateActivity();
    const roomLabel =
      (assignedRoom && isRealRoomRef(assignedRoom) && assignedRoom) ||
      existingRoom ||
      "TBA";
    const activityMessage = `[${ActivityType.CHECK_IN}] Check-in completed — ${existing.guestName ?? "Guest"}, Room ${roomLabel}`;
    const activityTs = formatTime();

    const { data, error } = await supabase.rpc("fo_check_in_reservation", {
      p_reservation_id: reservationId,
      p_activity_id: activityId,
      p_activity_message: activityMessage,
      p_activity_timestamp: activityTs,
    });

    if (!error && data) {
      let row = await enrichReservation(mapReservationRow(data));
      if (Object.keys(checkInExtras).length) {
        const {
          status: _s,
          arrivingToday: _a,
          roomNo: _r,
          roomRefId: _rr,
          ...rest
        } = sanitizeReservationInput(checkInExtras) as Record<string, unknown>;
        if (Object.keys(rest).length) {
          const updated = await foModel.update<Reservation>(
            foModel.tables.reservations,
            reservationId,
            rest,
          );
          row = await enrichReservation(updated);
        }
      }

      const finalRoom =
        (() => {
          const ref = resolveRoomRef(row);
          return ref && isRealRoomRef(ref) ? ref : "";
        })() ||
        (assignedRoom && isRealRoomRef(assignedRoom) ? assignedRoom : "") ||
        "";
      if (finalRoom) {
        await occupyRoom(finalRoom);
      }
      await ensureReservationFolio(row);

      const primaryGuestId = String(row.guestId ?? checkInExtras.guestId ?? "").trim();
      if (primaryGuestId || companionGuestIds.length) {
        await this.syncReservationGuests(
          reservationId,
          primaryGuestId || null,
          companionGuestIds,
        );
      }

      return row;
    }

    if (
      error &&
      !/fo_check_in_reservation|Could not find the function/i.test(
        error.message,
      )
    ) {
      throw new DatabaseError(error.message);
    }

    const fallback = await this.checkInFallback(
      reservationId,
      existing,
      checkInExtras,
    );
    const primaryGuestId = String(
      fallback.guestId ?? checkInExtras.guestId ?? "",
    ).trim();
    if (primaryGuestId || companionGuestIds.length) {
      await this.syncReservationGuests(
        reservationId,
        primaryGuestId || null,
        companionGuestIds,
      );
    }
    return fallback;
  },

  async checkInFallback(
    reservationId: string,
    existing: Reservation,
    extras: Partial<Reservation>,
  ): Promise<Reservation> {
    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      reservationId,
      {
        ...sanitizeReservationInput(extras),
        status: ReservationStatus.CHECKED_IN,
        arrivingToday: false,
      } as Record<string, unknown>,
    );
    const enriched = await enrichReservation(row);

    const roomRef =
      (() => {
        const ref = resolveRoomRef(enriched);
        return ref && isRealRoomRef(ref) ? ref : "";
      })() ||
      (() => {
        const ref = resolveRoomRef(extras);
        return ref && isRealRoomRef(ref) ? ref : "";
      })() ||
      (() => {
        const ref = resolveRoomRef(existing);
        return ref && isRealRoomRef(ref) ? ref : "";
      })() ||
      "";

    if (roomRef) {
      await occupyRoom(roomRef);
    }

    await ActivityService.log({
      type: ActivityType.CHECK_IN,
      message: `Check-in completed — ${existing.guestName ?? "Guest"}, Room ${roomRef || "TBA"}`,
      guestId: existing.guestId,
      room: roomRef || existingRoomRef(existing),
      reservationId,
    });

    await ensureReservationFolio(enriched);
    return enriched;
  },

  /**
   * Check-out (transactional via fo_check_out_reservation RPC when applied).
   */
  async checkOut(
    id: string,
    options: {
      paymentMode?: string;
      amountReceived?: number;
      externalReference?: string | null;
    } = {},
  ): Promise<Reservation> {
    const existing = await getOrThrow(id);
    const reservationId = existing.id;

    if (existing.status === ReservationStatus.CHECKED_OUT) {
      throw new ConflictError("Reservation is already checked out");
    }

    const amountReceived = Number(options.amountReceived ?? 0);
    const paymentId = IdService.generatePayment();
    const stayHistoryId = IdService.generateStayHistory();
    const activityId = IdService.generateActivity();
    const txnNo = IdService.generateTransactionNo();
    const payDate = formatDate();
    const roomLabel = resolveRoomRef(existing) ?? "TBA";
    const activityMessage = `[${ActivityType.CHECK_OUT}] Check-out completed — ${existing.guestName ?? "Guest"}, Room ${roomLabel}`;
    const activityTs = formatTime();

    const { data, error } = await supabase.rpc("fo_check_out_reservation", {
      p_reservation_id: reservationId,
      p_payment_mode: options.paymentMode ?? null,
      p_amount_received: amountReceived,
      p_payment_id: paymentId,
      p_transaction_no: txnNo,
      p_payment_date: payDate,
      p_stay_history_id: stayHistoryId,
      p_activity_id: activityId,
      p_activity_message: activityMessage,
      p_activity_timestamp: activityTs,
    });

    if (!error && data) {
      const enriched = enrichReservation(mapReservationRow(data));
      if (amountReceived > 0) {
        await TransactionService.recordFrontOfficePayment({
          amount: amountReceived,
          paymentMethod: options.paymentMode || existing.paymentMode || "Cash",
          bookingId: reservationId,
          guestId: existing.guestId ?? null,
          externalReference: options.externalReference ?? null,
          notes: `Checkout payment — ${String(existing.guestName ?? "Guest")}`,
        });
      }
      await FolioService.closeOpenFoliosForBooking(reservationId).catch(() => {
        /* folios table may not exist in older deployments */
      });
      return enriched;
    }

    if (
      error &&
      !/fo_check_out_reservation|Could not find the function/i.test(
        error.message,
      )
    ) {
      throw new DatabaseError(error.message);
    }

    return this.checkOutFallback(reservationId, existing, options);
  },

  async checkOutFallback(
    reservationId: string,
    existing: Reservation,
    options: {
      paymentMode?: string;
      amountReceived?: number;
      externalReference?: string | null;
    },
  ): Promise<Reservation> {
    const paymentMode = options.paymentMode;
    const amountReceived = Number(options.amountReceived ?? 0);

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      reservationId,
      {
        status: ReservationStatus.CHECKED_OUT,
        balance: 0,
        ...(paymentMode ? { paymentMode } : {}),
      } as Record<string, unknown>,
    );
    const enriched = await enrichReservation(row);

    if (amountReceived > 0) {
      await TransactionService.recordFrontOfficePayment({
        amount: amountReceived,
        paymentMethod: paymentMode || existing.paymentMode || "Cash",
        bookingId: reservationId,
        guestId: existing.guestId ?? null,
        externalReference: options.externalReference ?? null,
        notes: `Checkout payment — ${String(existing.guestName ?? "Guest")}`,
      });
    }

    const roomRef = resolveRoomRef(existing);
    if (roomRef && isRealRoomRef(roomRef)) {
      await releaseRoom(roomRef, RoomStatus.DIRTY);
      try {
        await HkTaskService.onCheckout({
          roomId: roomRef,
          bookingId: reservationId,
          notes: `Checkout cleaning for booking ${existing.bookingNo ?? reservationId}`,
        });
      } catch {
        /* HK task hook is best-effort in fallback path */
      }
    }

    if (existing.guestId) {
      await foModel.create(foModel.tables.guestStayHistory, {
        id: IdService.generateStayHistory(),
        guestId: existing.guestId,
        checkIn: existing.checkIn,
        checkOut: existing.checkOut,
        room: roomRef,
        roomType: existing.roomType,
        amount: existing.totalAmount ?? 0,
      });
    }

    await ActivityService.log({
      type: ActivityType.CHECK_OUT,
      message: `Check-out completed — ${existing.guestName ?? "Guest"}, Room ${roomRef ?? "TBA"}`,
      guestId: existing.guestId,
      room: roomRef,
      reservationId,
    });

    await FolioService.closeOpenFoliosForBooking(reservationId).catch(() => {
      /* folios table may not exist in older deployments */
    });

    return enriched;
  },

  async extendStay(
    id: string,
    payload: {
      checkOut: string;
      nights?: unknown;
      totalAmount?: unknown;
      balance?: unknown;
    },
  ): Promise<Reservation> {
    const existing = await getOrThrow(id);
    if (!payload.checkOut) throw new AppError("checkOut is required");

    if (
      existing.status === ReservationStatus.CANCELLED ||
      existing.status === ReservationStatus.NO_SHOW ||
      existing.status === ReservationStatus.CHECKED_OUT
    ) {
      throw new AppError(`Cannot extend a ${String(existing.status).toLowerCase()} booking`);
    }

    const checkIn = toIsoDate(existing.checkIn);
    const oldCheckOut = toIsoDate(existing.checkOut);
    const newCheckOut = toIsoDate(payload.checkOut);
    if (!checkIn || !oldCheckOut || !newCheckOut) {
      throw new AppError("Invalid stay dates");
    }
    if (newCheckOut <= oldCheckOut) {
      throw new AppError(`New check-out must be after the current check-out (${oldCheckOut})`);
    }

    const roomRef = resolveRoomRef(existing);
    if (roomRef && isRealRoomRef(roomRef)) {
      const room = await getRoomByRef(roomRef);
      if (room?.id) {
        const { data: others, error } = await supabase
          .from(foModel.tables.reservations)
          .select("id, check_in, check_out, status")
          .eq("room_ref_id", room.id)
          .neq("id", existing.id)
          .not("status", "in", `("${ReservationStatus.CANCELLED}","${ReservationStatus.CHECKED_OUT}","${ReservationStatus.NO_SHOW}")`);
        if (error) throw new DatabaseError(error.message);
        const clash = (others ?? []).find((r) => {
          const otherIn = toIsoDate(String(r.check_in ?? ""));
          const otherOut = toIsoDate(String(r.check_out ?? ""));
          return otherIn && otherOut && otherIn < newCheckOut && otherOut > oldCheckOut;
        });
        if (clash) {
          throw new ConflictError(
            `Room ${room.roomNo} is booked from ${toIsoDate(String(clash.check_in))} — transfer the guest to another room or pick an earlier date`,
          );
        }
      }
    }

    const oldNights = Math.max(1, Number(existing.nights) || nightsBetween(checkIn, oldCheckOut));
    const newNights = nightsBetween(checkIn, newCheckOut);
    const extraNights = Math.max(0, newNights - nightsBetween(checkIn, oldCheckOut));
    const rate =
      Number(existing.roomRate) ||
      Math.round((Number(existing.totalAmount) || 0) / oldNights);
    const extraAmount = Math.round(extraNights * rate * 100) / 100;

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      existing.id,
      {
        checkOut: newCheckOut,
        nights: newNights,
        totalAmount: (Number(existing.totalAmount) || 0) + extraAmount,
        balance: (Number(existing.balance) || 0) + extraAmount,
      } as Record<string, unknown>,
    );

    if (extraAmount > 0) {
      if (existing.groupId) {
        await FolioChargeService.post({
          reservationId: existing.id,
          chargeCategory: FoChargeCategory.ROOM,
          description: `Stay extension — ${extraNights} night${extraNights !== 1 ? "s" : ""}`,
          quantity: extraNights,
          unitPrice: rate,
          guestId: existing.guestId ?? null,
          sourceModule: "FRONT_OFFICE",
          sourceType: "EXTEND_STAY",
        });
      } else {
        const folioId = await TransactionService.ensureFolioForBooking(
          existing.id,
          existing.guestId ?? null,
        );
        const folio = await foModel.get<{ subtotal?: number }>(foModel.tables.folios, folioId);
        await foModel.update(foModel.tables.folios, folioId, {
          subtotal: Math.round((Number(folio?.subtotal ?? 0) + extraAmount) * 100) / 100,
        });
      }
    }

    await ActivityService.log({
      type: ActivityType.EXTEND_STAY,
      message: `Stay extended — ${existing.guestName ?? "Guest"}, checkout ${newCheckOut} (+${extraNights} night${extraNights !== 1 ? "s" : ""})`,
      guestId: existing.guestId,
      room: roomRef,
      reservationId: existing.id,
    });

    return enrichReservation(row);
  },

  /** Move an in-house guest to another room; the vacated room goes to housekeeping as dirty. */
  async transferRoom(
    id: string,
    payload: { toRoom: string; reason?: string; date?: string },
  ): Promise<Reservation> {
    const existing = await getOrThrow(id);
    if (
      existing.status !== ReservationStatus.CHECKED_IN &&
      existing.status !== ReservationStatus.IN_HOUSE
    ) {
      throw new AppError("Only in-house guests can be transferred to another room");
    }

    const target = await getRoomByRef(payload.toRoom);
    if (!target?.id) throw new NotFoundError(`Room "${payload.toRoom}" was not found`);

    const fromRef = resolveRoomRef(existing);
    const fromRoom = fromRef && isRealRoomRef(fromRef) ? await getRoomByRef(fromRef) : null;
    if (fromRoom?.id === target.id) {
      throw new AppError("Guest is already in this room");
    }

    const { data: occupants, error: occupantsError } = await supabase
      .from(foModel.tables.reservations)
      .select("id")
      .eq("room_ref_id", target.id)
      .in("status", [ReservationStatus.CHECKED_IN, ReservationStatus.IN_HOUSE])
      .neq("id", existing.id)
      .limit(1);
    if (occupantsError) throw new DatabaseError(occupantsError.message);
    if (occupants?.length) {
      throw new ConflictError(`Room ${target.roomNo} is occupied by another guest`);
    }

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      existing.id,
      { roomRefId: target.id } as Record<string, unknown>,
    );
    if (fromRoom?.id) await markRoomDirty(fromRoom.id);

    const fromLabel = fromRoom?.roomNo ?? displayRoomNo(existing) ?? "TBA";
    await foModel.create(foModel.tables.roomTransfers, {
      id: foModel.newId("TR"),
      guestName: existing.guestName ?? "Guest",
      fromRoom: fromLabel,
      toRoom: target.roomNo,
      date: payload.date || formatDate(),
      reason: payload.reason?.trim() || "Guest request",
      status: "Completed",
    });

    await ActivityService.log({
      type: ActivityType.ROOM_TRANSFER,
      message: `Room transfer — ${existing.guestName ?? "Guest"}, Room ${fromLabel} → ${target.roomNo}`,
      guestId: existing.guestId,
      room: target.roomNo,
      reservationId: existing.id,
    });

    return enrichReservation(row);
  },

  async getSummary(): Promise<SummaryCard[]> {
    const rows = await foModel.list<Reservation>(foModel.tables.reservations);
    return [
      {
        label: "Total",
        value: rows.length,
        icon: "calendar",
        color: "#16a34a",
      },
      {
        label: "Arriving Today",
        value: rows.filter(
          (r) =>
            isArrivingTodayReservation(r) &&
            r.status !== ReservationStatus.CANCELLED &&
            r.status !== ReservationStatus.CHECKED_OUT &&
            r.status !== ReservationStatus.NO_SHOW,
        ).length,
        icon: "user-check",
        color: "#22c55e",
      },
      {
        label: "In-House",
        value: rows.filter(
          (r) =>
            r.status === ReservationStatus.CHECKED_IN ||
            r.status === ReservationStatus.IN_HOUSE,
        ).length,
        icon: "bed",
        color: "#a855f7",
      },
      {
        label: "Outstanding",
        value: rows.filter((r) => Number(r.balance) > 0).length,
        icon: "wallet",
        color: "#eab308",
      },
    ];
  },

  async listInHouse(): Promise<InHouseGuest[]> {
    const { data, error } = await supabase
      .from(foModel.tables.reservations)
      .select("*")
      .in("status", [ReservationStatus.CHECKED_IN, ReservationStatus.IN_HOUSE])
      .order("check_out", { ascending: true });

    if (error) throw new DatabaseError(error.message);

    const rows = await enrichReservations(
      (data ?? []).map((row) => toCamel<Reservation>(row)),
    );
    await Promise.all(rows.map((r) => ensureReservationFolio(r)));
    return rows.map((r) => ({
      id: r.id,
      guestId: r.guestId ?? undefined,
      bookingNo: r.bookingNo,
      guestNo: r.guestNo,
      guestName: r.guestName ?? "",
      room: displayRoomNo(r) || "TBA",
      roomType: r.roomType,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: r.nights ?? 1,
      balance: r.balance ?? 0,
      restaurantBill: r.restaurantBill ?? 0,
      laundry: r.laundry ?? 0,
      status: String(r.status),
      isVip: r.isVip ?? false,
      phone: r.phone,
      email: r.email,
      adults: r.adults ?? 1,
      children: r.children ?? 0,
    }));
  },

  /** Latest reservation for a room (in-house > reserved > recent checkout). */
  async findCurrentForRoom(roomKey: string): Promise<Reservation | null> {
    const roomId = await resolveRoomId(roomKey);
    if (!roomId) return null;

    const { data, error } = await supabase
      .from(foModel.tables.reservations)
      .select("*")
      .eq("room_ref_id", roomId)
      .in("status", [
        ReservationStatus.CHECKED_IN,
        ReservationStatus.IN_HOUSE,
        ReservationStatus.CONFIRMED,
        ReservationStatus.RESERVED,
        ReservationStatus.CHECKED_OUT,
      ])
      .order("created_at", { ascending: false });

    if (error) throw new DatabaseError(error.message);
    const rows = await enrichReservations(
      (data ?? []).map((row) => toCamel<Reservation>(row)),
    );
    if (!rows.length) return null;

    const inHouse = rows.find(
      (r) =>
        r.status === ReservationStatus.CHECKED_IN ||
        r.status === ReservationStatus.IN_HOUSE,
    );
    if (inHouse) return inHouse;

    const reserved = rows.find(
      (r) =>
        r.status === ReservationStatus.CONFIRMED ||
        r.status === ReservationStatus.RESERVED,
    );
    if (reserved) return reserved;

    return rows.find((r) => r.status === ReservationStatus.CHECKED_OUT) ?? null;
  },

  /** Replace guest list for a booking (primary + companions). */
  async syncReservationGuests(
    reservationId: string,
    primaryGuestId: string | null,
    companionGuestIds: string[] = [],
  ): Promise<ReservationGuestLink[]> {
    const propertyId = getActivePropertyId();
    const { error: delErr } = await supabase
      .from(foModel.tables.reservationGuests)
      .delete()
      .eq("reservation_id", reservationId);
    if (delErr) throw new Error(delErr.message);

    const rows: Array<Record<string, unknown>> = [];
    if (primaryGuestId) {
      rows.push({
        property_id: propertyId ?? null,
        reservation_id: reservationId,
        guest_id: primaryGuestId,
        role: "PRIMARY",
      });
    }
    for (const guestId of companionGuestIds) {
      if (!guestId || guestId === primaryGuestId) continue;
      rows.push({
        property_id: propertyId ?? null,
        reservation_id: reservationId,
        guest_id: guestId,
        role: "COMPANION",
      });
    }

    if (rows.length) {
      const { error: insErr } = await supabase
        .from(foModel.tables.reservationGuests)
        .insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return this.listReservationGuests(reservationId);
  },

  async listReservationGuests(
    reservationId: string,
  ): Promise<ReservationGuestLink[]> {
    const links = await foModel.list<ReservationGuestLink>(
      foModel.tables.reservationGuests,
      {
        filters: { reservation_id: reservationId },
        orderBy: "created_at",
        ascending: true,
      },
    );
    if (!links.length) return [];

    const guestIds = [...new Set(links.map((l) => l.guestId).filter(Boolean))];
    const { data, error } = await supabase
      .from(foModel.tables.guests)
      .select("*")
      .in("id", guestIds);
    if (error) throw new Error(error.message);

    const guestMap = new Map<string, Guest>();
    for (const row of data ?? []) {
      const g = toCamel<Guest>(row as Record<string, unknown>);
      guestMap.set(g.id, g);
    }

    return links.map((link) => {
      const g = guestMap.get(link.guestId);
      return {
        ...link,
        guestName: g?.name,
        guestNo: g?.guestNo,
        mobile: g?.mobile,
        email: g?.email,
      };
    });
  },
};

function existingRoomRef(existing: Reservation): string | null {
  return resolveRoomRef(existing);
}

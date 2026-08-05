import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import {
  ActivityType,
  HousekeepingStatus,
  ReservationStatus,
  RoomStatus,
} from "../../constants/front-office.js";
import type {
  InHouseGuest,
  Reservation,
  SummaryCard,
} from "../../types/front-office.js";
import {
  AppError,
  ConflictError,
  DatabaseError,
  NotFoundError,
} from "../../errors/index.js";
import { formatDate, formatTime, isArrivingTodayReservation, timestamp } from "../../utils/date.js";
import { IdService } from "../shared/id.service.js";
import { ActivityService } from "../shared/activity.service.js";
import { PaymentService } from "../shared/payment.service.js";

async function getOrThrow(id: string): Promise<Reservation> {
  const row = await foModel.get<Reservation>(foModel.tables.reservations, id);
  if (!row) throw new NotFoundError("Reservation not found");
  return row;
}

function mapReservationRow(raw: unknown): Reservation {
  return toCamel<Reservation>(raw as Record<string, unknown>);
}

/**
 * ReservationService — business workflows for FO reservations.
 * Check-in / check-out prefer transactional Postgres RPCs when available.
 */
export const ReservationService = {
  async list(status?: string): Promise<Reservation[]> {
    return foModel.list<Reservation>(foModel.tables.reservations, {
      filters: status ? { status } : undefined,
      orderBy: "id",
      ascending: false,
    });
  },

  async getById(id: string): Promise<Reservation> {
    return getOrThrow(id);
  },

  async create(input: Partial<Reservation>): Promise<Reservation> {
    const body: Partial<Reservation> = { ...input };
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

    await ActivityService.log({
      type: ActivityType.RESERVATION_CREATED,
      message: `New reservation — ${body.guestName}, ${body.roomNo ?? "TBA"}`,
      guestId: body.guestId,
      room: body.roomNo,
      reservationId: body.id,
    });

    return row;
  },

  async update(
    id: string,
    input: Partial<Reservation>,
  ): Promise<Reservation> {
    await getOrThrow(id);
    const body = { ...input } as Record<string, unknown>;
    delete body.id;
    return foModel.update<Reservation>(foModel.tables.reservations, id, body);
  },

  async remove(id: string): Promise<{ id: string }> {
    await getOrThrow(id);
    await foModel.remove(foModel.tables.reservations, id);
    return { id };
  },

  /**
   * Check-in (transactional via fo_check_in_reservation RPC when applied).
   * Fallback: sequential writes if RPC is not installed yet.
   */
  async checkIn(
    id: string,
    extras: Partial<Reservation> = {},
  ): Promise<Reservation> {
    const existing = await getOrThrow(id);

    if (existing.status === ReservationStatus.CHECKED_OUT) {
      throw new ConflictError("Cannot check in a checked-out reservation");
    }
    if (
      existing.status === ReservationStatus.CHECKED_IN ||
      existing.status === ReservationStatus.IN_HOUSE
    ) {
      throw new ConflictError("Guest is already checked in");
    }

    const activityId = IdService.generateActivity();
    const activityMessage = `[${ActivityType.CHECK_IN}] Check-in completed — ${existing.guestName}, Room ${existing.roomNo}`;
    const activityTs = formatTime();

    const { data, error } = await supabase.rpc("fo_check_in_reservation", {
      p_reservation_id: id,
      p_activity_id: activityId,
      p_activity_message: activityMessage,
      p_activity_timestamp: activityTs,
    });

    if (!error && data) {
      // Apply any extra body fields after successful transactional core update
      if (Object.keys(extras).length) {
        const { status: _s, arrivingToday: _a, ...rest } = extras;
        if (Object.keys(rest).length) {
          return foModel.update<Reservation>(
            foModel.tables.reservations,
            id,
            rest as Record<string, unknown>,
          );
        }
      }
      return mapReservationRow(data);
    }

    // Fallback if RPC not applied yet
    if (error && !/fo_check_in_reservation|Could not find the function/i.test(error.message)) {
      throw new DatabaseError(error.message);
    }

    return this.checkInFallback(id, existing, extras);
  },

  async checkInFallback(
    id: string,
    existing: Reservation,
    extras: Partial<Reservation>,
  ): Promise<Reservation> {
    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      id,
      {
        ...extras,
        status: ReservationStatus.CHECKED_IN,
        arrivingToday: false,
      } as Record<string, unknown>,
    );

    if (existing.roomNo) {
      await foModel.update(
        foModel.tables.rooms,
        String(existing.roomNo),
        {
          status: RoomStatus.OCCUPIED,
          guestName: existing.guestName,
          housekeeping: HousekeepingStatus.CLEAN,
          checkoutDate: existing.checkOut,
        },
        "room_no",
      );
    }

    await ActivityService.log({
      type: ActivityType.CHECK_IN,
      message: `Check-in completed — ${existing.guestName}, Room ${existing.roomNo}`,
      guestId: existing.guestId,
      room: existing.roomNo,
      reservationId: id,
    });

    return row;
  },

  /**
   * Check-out (transactional via fo_check_out_reservation RPC when applied).
   */
  async checkOut(
    id: string,
    options: { paymentMode?: string; amountReceived?: number } = {},
  ): Promise<Reservation> {
    const existing = await getOrThrow(id);

    if (existing.status === ReservationStatus.CHECKED_OUT) {
      throw new ConflictError("Reservation is already checked out");
    }

    const amountReceived = Number(options.amountReceived ?? 0);
    const paymentId = IdService.generatePayment();
    const stayHistoryId = IdService.generateStayHistory();
    const activityId = IdService.generateActivity();
    const txnNo = IdService.generateTransactionNo();
    const payDate = formatDate();
    const activityMessage = `[${ActivityType.CHECK_OUT}] Check-out completed — ${existing.guestName}, Room ${existing.roomNo}`;
    const activityTs = formatTime();

    const { data, error } = await supabase.rpc("fo_check_out_reservation", {
      p_reservation_id: id,
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
      return mapReservationRow(data);
    }

    if (error && !/fo_check_out_reservation|Could not find the function/i.test(error.message)) {
      throw new DatabaseError(error.message);
    }

    return this.checkOutFallback(id, existing, options);
  },

  async checkOutFallback(
    id: string,
    existing: Reservation,
    options: { paymentMode?: string; amountReceived?: number },
  ): Promise<Reservation> {
    const paymentMode = options.paymentMode;
    const amountReceived = Number(options.amountReceived ?? 0);

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      id,
      {
        status: ReservationStatus.CHECKED_OUT,
        balance: 0,
        ...(paymentMode ? { paymentMode } : {}),
      } as Record<string, unknown>,
    );

    if (amountReceived > 0) {
      await PaymentService.record({
        guestName: String(existing.guestName),
        room: existing.roomNo,
        reservationId: id,
        amount: amountReceived,
        mode: paymentMode || existing.paymentMode || "Cash",
      });
    }

    if (existing.roomNo) {
      await foModel.update(
        foModel.tables.rooms,
        String(existing.roomNo),
        {
          status: RoomStatus.DIRTY,
          guestName: null,
          housekeeping: HousekeepingStatus.DIRTY,
          checkoutDate: null,
        },
        "room_no",
      );
    }

    if (existing.guestId) {
      await foModel.create(foModel.tables.guestStayHistory, {
        id: IdService.generateStayHistory(),
        guestId: existing.guestId,
        checkIn: existing.checkIn,
        checkOut: existing.checkOut,
        room: existing.roomNo,
        roomType: existing.roomType,
        amount: existing.totalAmount ?? 0,
      });
    }

    await ActivityService.log({
      type: ActivityType.CHECK_OUT,
      message: `Check-out completed — ${existing.guestName}, Room ${existing.roomNo}`,
      guestId: existing.guestId,
      room: existing.roomNo,
      reservationId: id,
    });

    return row;
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
    await getOrThrow(id);
    if (!payload.checkOut) throw new AppError("checkOut is required");

    const row = await foModel.update<Reservation>(
      foModel.tables.reservations,
      id,
      {
        checkOut: payload.checkOut,
        ...(payload.nights !== undefined ? { nights: payload.nights } : {}),
        ...(payload.totalAmount !== undefined
          ? { totalAmount: payload.totalAmount }
          : {}),
        ...(payload.balance !== undefined ? { balance: payload.balance } : {}),
      } as Record<string, unknown>,
    );

    await ActivityService.log({
      type: ActivityType.EXTEND_STAY,
      message: `Stay extended — checkout ${payload.checkOut}`,
      reservationId: id,
    });

    return row;
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
            r.status !== ReservationStatus.CHECKED_OUT,
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
    const rows = await foModel.list<Reservation>(foModel.tables.reservations, {
      filters: { status: ReservationStatus.CHECKED_IN },
    });
    return rows.map((r) => ({
      id: r.id,
      guestName: r.guestName,
      room: r.roomNo,
      roomType: r.roomType,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: r.nights ?? 1,
      balance: r.balance ?? 0,
      restaurantBill: r.restaurantBill ?? 0,
      laundry: r.laundry ?? 0,
      status: String(r.status),
      isVip: r.isVip ?? false,
      email: r.email,
      adults: r.adults ?? 1,
      children: r.children ?? 0,
    }));
  },
};

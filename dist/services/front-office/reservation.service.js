import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { ActivityType, ReservationStatus, RoomStatus, } from "../../constants/front-office.js";
import { AppError, ConflictError, DatabaseError, NotFoundError, } from "../../errors/index.js";
import { formatDate, formatTime, isArrivingTodayReservation, timestamp, } from "../../utils/date.js";
import { IdService } from "../shared/id.service.js";
import { ActivityService } from "../shared/activity.service.js";
import { TransactionService } from "../shared/transaction.service.js";
import { enrichReservation, enrichReservations, displayRoomNo, isRealRoomRef, normalizeReservationRoomRef, normalizeReservationSourceRef, resolveRoomRef, sanitizeReservationInput, } from "./reservation-enrich.js";
import { getRoomByRef, resolveRoomId } from "./room-resolver.js";
import { getReservationByKey, } from "./reservation-lookup.js";
import { HkTaskService } from "../housekeeping/hk-task.service.js";
async function ensureReservationFolio(reservation) {
    try {
        await TransactionService.ensureFolioForBooking(reservation.id, reservation.guestId ?? null);
    }
    catch {
        // Do not block reservation reads if folios schema is not applied yet
    }
}
async function getOrThrow(id) {
    const row = await getReservationByKey(id);
    if (!row)
        throw new NotFoundError("Reservation not found");
    return enrichReservation(row);
}
function mapReservationRow(raw) {
    return toCamel(raw);
}
async function markRoomDirty(roomId) {
    const { error } = await supabase.rpc("hk_ensure_room_dirty", {
        p_room_id: roomId,
    });
    if (error)
        throw new DatabaseError(error.message);
}
/** FO room cards derive Reserved/Occupied from reservations; hk_rooms holds HK readiness only. */
async function reserveRoom(_roomRef) {
    /* no-op — reservation status is the source of truth */
}
async function occupyRoom(_roomRef) {
    /* no-op — checked-in reservation drives Occupied in FO views */
}
async function releaseRoom(roomRef, toStatus = RoomStatus.VACANT) {
    if (!isRealRoomRef(roomRef))
        return;
    if (toStatus !== RoomStatus.DIRTY)
        return;
    const room = await getRoomByRef(String(roomRef).trim());
    if (!room?.id)
        return;
    await markRoomDirty(room.id);
}
/**
 * ReservationService — business workflows for FO reservations.
 * Check-in / check-out prefer transactional Postgres RPCs when available.
 */
export const ReservationService = {
    async list(status) {
        const rows = await foModel.list(foModel.tables.reservations, {
            filters: status ? { status } : undefined,
            orderBy: "id",
            ascending: false,
        });
        return enrichReservations(rows);
    },
    async getById(id) {
        const row = await getOrThrow(id);
        await ensureReservationFolio(row);
        return row;
    },
    async create(input) {
        if (!input.guestId?.trim()) {
            throw new AppError("guestId is required — create or select a guest profile first");
        }
        const externalReference = String(input.externalReference ?? input.paymentReference ?? "").trim();
        const advancePaid = Number(input.advancePaid ?? 0);
        const totalAmount = Number(input.totalAmount ?? 0);
        if (advancePaid > 0 && !String(input.paymentMode ?? "").trim()) {
            throw new AppError("Payment method is required when advance amount is collected");
        }
        const body = sanitizeReservationInput(input);
        delete body.externalReference;
        delete body.paymentReference;
        await normalizeReservationRoomRef(body);
        await normalizeReservationSourceRef(body);
        if (!body.id)
            body.id = IdService.generateReservation();
        if (!body.createdAt)
            body.createdAt = timestamp();
        if (!body.status)
            body.status = ReservationStatus.CONFIRMED;
        if (body.checkIn && isArrivingTodayReservation(body)) {
            body.arrivingToday = true;
        }
        const row = await foModel.create(foModel.tables.reservations, body);
        const enriched = await enrichReservation(row);
        const roomRef = resolveRoomRef(enriched);
        if (roomRef && isRealRoomRef(roomRef)) {
            await reserveRoom(roomRef);
        }
        await ActivityService.log({
            type: ActivityType.RESERVATION_CREATED,
            message: `New reservation — ${enriched.guestName ?? "Guest"}, ${roomRef ?? "TBA"}`,
            guestId: String(body.guestId ?? input.guestId ?? ""),
            room: roomRef,
            reservationId: String(body.id ?? ""),
        });
        const guestId = String(body.guestId ?? input.guestId ?? "");
        const folioId = await TransactionService.ensureFolioForBooking(enriched.id, guestId);
        if (totalAmount > 0) {
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
    async update(id, input) {
        const existing = await getOrThrow(id);
        const body = sanitizeReservationInput(input);
        delete body.id;
        await normalizeReservationRoomRef(body);
        await normalizeReservationSourceRef(body);
        const row = await foModel.update(foModel.tables.reservations, existing.id, body);
        const enriched = await enrichReservation(row);
        const nextStatus = String(enriched.status ?? existing.status);
        const prevRoom = resolveRoomRef(existing);
        const nextRoom = resolveRoomRef(enriched);
        const prevRoomReal = prevRoom && isRealRoomRef(prevRoom) ? prevRoom : "";
        const nextRoomReal = nextRoom && isRealRoomRef(nextRoom) ? nextRoom : "";
        if (nextStatus === ReservationStatus.CANCELLED ||
            nextStatus === ReservationStatus.CHECKED_OUT ||
            nextStatus === ReservationStatus.NO_SHOW) {
            if (prevRoomReal)
                await releaseRoom(prevRoomReal, RoomStatus.VACANT);
            return enriched;
        }
        if (prevRoomReal && prevRoomReal !== nextRoomReal) {
            await releaseRoom(prevRoomReal, RoomStatus.VACANT);
        }
        if (nextRoomReal) {
            if (nextStatus === ReservationStatus.CHECKED_IN ||
                nextStatus === ReservationStatus.IN_HOUSE) {
                await occupyRoom(nextRoomReal);
            }
            else {
                await reserveRoom(nextRoomReal);
            }
        }
        return enriched;
    },
    async remove(id) {
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
    async checkIn(id, extras = {}) {
        let existing = await getOrThrow(id);
        const reservationId = existing.id;
        if (existing.status === ReservationStatus.CHECKED_OUT) {
            throw new ConflictError("Cannot check in a checked-out reservation");
        }
        if (existing.status === ReservationStatus.CHECKED_IN ||
            existing.status === ReservationStatus.IN_HOUSE) {
            throw new ConflictError("Guest is already checked in");
        }
        const assignedRoom = resolveRoomRef(extras);
        const existingRoom = resolveRoomRef(existing);
        if (assignedRoom &&
            isRealRoomRef(assignedRoom) &&
            assignedRoom !== existingRoom) {
            const { status: _s, arrivingToday: _a, ...roomPatch } = sanitizeReservationInput(extras);
            await normalizeReservationRoomRef(roomPatch);
            const updated = await foModel.update(foModel.tables.reservations, reservationId, roomPatch);
            existing = await enrichReservation(updated);
        }
        const activityId = IdService.generateActivity();
        const roomLabel = (assignedRoom && isRealRoomRef(assignedRoom) && assignedRoom) ||
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
            if (Object.keys(extras).length) {
                const { status: _s, arrivingToday: _a, roomNo: _r, roomRefId: _rr, ...rest } = sanitizeReservationInput(extras);
                if (Object.keys(rest).length) {
                    const updated = await foModel.update(foModel.tables.reservations, reservationId, rest);
                    row = await enrichReservation(updated);
                }
            }
            const finalRoom = (() => {
                const ref = resolveRoomRef(row);
                return ref && isRealRoomRef(ref) ? ref : "";
            })() ||
                (assignedRoom && isRealRoomRef(assignedRoom) ? assignedRoom : "") ||
                "";
            if (finalRoom) {
                await occupyRoom(finalRoom);
            }
            await ensureReservationFolio(row);
            return row;
        }
        if (error &&
            !/fo_check_in_reservation|Could not find the function/i.test(error.message)) {
            throw new DatabaseError(error.message);
        }
        return this.checkInFallback(reservationId, existing, extras);
    },
    async checkInFallback(reservationId, existing, extras) {
        const row = await foModel.update(foModel.tables.reservations, reservationId, {
            ...sanitizeReservationInput(extras),
            status: ReservationStatus.CHECKED_IN,
            arrivingToday: false,
        });
        const enriched = await enrichReservation(row);
        const roomRef = (() => {
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
    async checkOut(id, options = {}) {
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
            return enriched;
        }
        if (error &&
            !/fo_check_out_reservation|Could not find the function/i.test(error.message)) {
            throw new DatabaseError(error.message);
        }
        return this.checkOutFallback(reservationId, existing, options);
    },
    async checkOutFallback(reservationId, existing, options) {
        const paymentMode = options.paymentMode;
        const amountReceived = Number(options.amountReceived ?? 0);
        const row = await foModel.update(foModel.tables.reservations, reservationId, {
            status: ReservationStatus.CHECKED_OUT,
            balance: 0,
            ...(paymentMode ? { paymentMode } : {}),
        });
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
            }
            catch {
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
        return enriched;
    },
    async extendStay(id, payload) {
        const existing = await getOrThrow(id);
        if (!payload.checkOut)
            throw new AppError("checkOut is required");
        const row = await foModel.update(foModel.tables.reservations, existing.id, {
            checkOut: payload.checkOut,
            ...(payload.nights !== undefined ? { nights: payload.nights } : {}),
            ...(payload.totalAmount !== undefined
                ? { totalAmount: payload.totalAmount }
                : {}),
            ...(payload.balance !== undefined ? { balance: payload.balance } : {}),
        });
        await ActivityService.log({
            type: ActivityType.EXTEND_STAY,
            message: `Stay extended — checkout ${payload.checkOut}`,
            reservationId: existing.id,
        });
        return enrichReservation(row);
    },
    async getSummary() {
        const rows = await foModel.list(foModel.tables.reservations);
        return [
            {
                label: "Total",
                value: rows.length,
                icon: "calendar",
                color: "#16a34a",
            },
            {
                label: "Arriving Today",
                value: rows.filter((r) => isArrivingTodayReservation(r) &&
                    r.status !== ReservationStatus.CANCELLED &&
                    r.status !== ReservationStatus.CHECKED_OUT).length,
                icon: "user-check",
                color: "#22c55e",
            },
            {
                label: "In-House",
                value: rows.filter((r) => r.status === ReservationStatus.CHECKED_IN ||
                    r.status === ReservationStatus.IN_HOUSE).length,
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
    async listInHouse() {
        const { data, error } = await supabase
            .from(foModel.tables.reservations)
            .select("*")
            .in("status", [ReservationStatus.CHECKED_IN, ReservationStatus.IN_HOUSE])
            .order("check_out", { ascending: true });
        if (error)
            throw new DatabaseError(error.message);
        const rows = await enrichReservations((data ?? []).map((row) => toCamel(row)));
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
    async findCurrentForRoom(roomKey) {
        const roomId = await resolveRoomId(roomKey);
        if (!roomId)
            return null;
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
        if (error)
            throw new DatabaseError(error.message);
        const rows = await enrichReservations((data ?? []).map((row) => toCamel(row)));
        if (!rows.length)
            return null;
        const inHouse = rows.find((r) => r.status === ReservationStatus.CHECKED_IN ||
            r.status === ReservationStatus.IN_HOUSE);
        if (inHouse)
            return inHouse;
        const reserved = rows.find((r) => r.status === ReservationStatus.CONFIRMED ||
            r.status === ReservationStatus.RESERVED);
        if (reserved)
            return reserved;
        return rows.find((r) => r.status === ReservationStatus.CHECKED_OUT) ?? null;
    },
};
function existingRoomRef(existing) {
    return resolveRoomRef(existing);
}
//# sourceMappingURL=reservation.service.js.map
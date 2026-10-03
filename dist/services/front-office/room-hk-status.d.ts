import { type HkRoomStatus } from "../../types/housekeeping.js";
type BookingOverlay = {
    guestName?: string;
    checkOut?: string;
    status?: string;
};
export declare function fetchHkStatusByRoomIds(roomIds: string[]): Promise<Map<string, HkRoomStatus>>;
export declare function foStatusQueryToHkStatuses(status: string): HkRoomStatus[] | null;
export declare function hkStatusToHousekeeping(hkStatus: HkRoomStatus): string;
export declare function hkStatusToMaintenance(hkStatus: HkRoomStatus): string;
/** Base FO room status from hk_rooms (before reservation overlay). */
export declare function hkStatusToBaseFoStatus(hkStatus: HkRoomStatus): string;
export declare function deriveFoRoomStatus(hkStatus: HkRoomStatus, booking?: BookingOverlay | null, isActive?: boolean): string;
export declare function isHkRoomSellable(hkStatus: HkRoomStatus, isActive?: boolean): boolean;
export declare function ensureHkRoomForFoRoom(roomId: string): Promise<void>;
type ReservationLike = {
    roomNo?: unknown;
    status?: unknown;
    guestName?: unknown;
    checkIn?: unknown;
    checkOut?: unknown;
};
export declare function localTodayIso(now?: Date): string;
/**
 * The reservation holding each room today: in-house guests always (including overstays),
 * otherwise only bookings whose stay covers today — future and missed arrivals do not hold the room.
 */
export declare function buildActiveBookingByRoomNo<T extends ReservationLike>(reservations: T[], todayIso?: string): Map<string, T>;
export declare function availabilityCalendarDayStatus(params: {
    dayIso: string;
    todayIso: string;
    isActive: boolean;
    hasBooking: boolean;
    bookingInHouse: boolean;
    /** Date-scoped block from room_availability_blocks or blocking maintenance_requests */
    datedBlock: "none" | "maintenance" | "blocked";
    /** Current HK readiness — used for today-only dirty/OOS indicator, not month-wide paint */
    hkStatus?: HkRoomStatus;
}): "available" | "reserved" | "occupied" | "dirty" | "maintenance" | "blocked";
/**
 * @deprecated Use availabilityCalendarDayStatus — applies HK status to every day (incorrect for calendar).
 */
export declare function availabilityDayStatus(hkStatus: HkRoomStatus, isActive: boolean, hasBooking: boolean, bookingInHouse: boolean): "available" | "reserved" | "occupied" | "dirty" | "maintenance" | "blocked";
export {};

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
    checkOut?: unknown;
};
export declare function buildActiveBookingByRoomNo<T extends ReservationLike>(reservations: T[]): Map<string, T>;
export declare function availabilityDayStatus(hkStatus: HkRoomStatus, isActive: boolean, hasBooking: boolean, bookingInHouse: boolean): "available" | "reserved" | "occupied" | "dirty" | "maintenance" | "blocked";
export {};

/** Shared date/time formatting for the whole API. */
export declare function formatTime(date?: Date): string;
export declare function formatDate(date?: Date): string;
export declare function timestamp(date?: Date): string;
export declare function todayIso(date?: Date): string;
export declare function isArrivingTodayReservation(booking: {
    checkIn?: string;
    arrivingToday?: boolean;
}, now?: Date): boolean;
/** @deprecated Prefer formatTime / formatDate / timestamp */
export declare const nowTime: typeof formatTime;
export declare const nowDate: typeof formatDate;
export declare const nowStamp: typeof timestamp;

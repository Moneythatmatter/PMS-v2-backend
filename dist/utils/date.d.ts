/** Shared date/time formatting for the whole API. */
export declare function formatTime(date?: Date): string;
export declare function formatDate(date?: Date): string;
export declare function timestamp(date?: Date): string;
/** @deprecated Prefer formatTime / formatDate / timestamp */
export declare const nowTime: typeof formatTime;
export declare const nowDate: typeof formatDate;
export declare const nowStamp: typeof timestamp;

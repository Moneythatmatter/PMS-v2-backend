/** Reservation dates and times are entered in the hotel's local time, not the server's. */
export declare const PROPERTY_TZ: string;
export declare function isIsoDate(value: unknown): value is string;
/** "19:30", "7:30 PM" → "19:30"; null when it can't be read. */
export declare function normalizeTime(value: unknown): string | null;
/** Local date + HH:MM in the property zone → UTC instant. */
export declare function zonedDateTimeToUtc(date: string, time: string, timeZone?: string): Date;
/** Today's date in the property zone, YYYY-MM-DD. */
export declare function propertyToday(now?: Date, timeZone?: string): string;
export declare function formatPropertyTime(date: Date, timeZone?: string): string;

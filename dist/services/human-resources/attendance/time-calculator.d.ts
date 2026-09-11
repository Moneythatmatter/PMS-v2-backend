/** Parse HH:MM or HH:MM AM/PM to minutes from midnight. */
export declare function parseTimeToMinutes(time: string): number | null;
export type ShiftTiming = {
    startTime: string;
    endTime: string;
    breakDurationMinutes: number;
    totalWorkingHours: number;
    isNightShift: boolean;
};
/** Build a Date on attendanceDate at the given clock time (local server TZ). */
export declare function dateAtTime(attendanceDate: string, time: string): Date | null;
/** Shift end instant; rolls to next calendar day for overnight shifts. */
export declare function shiftEndDateTime(attendanceDate: string, shift: ShiftTiming): Date | null;
/** Gross punch duration in hours (handles overnight punch-out). */
export declare function grossPunchHours(punchIn: Date, punchOut: Date): number;
/** Net worked hours after break deduction from shift master. */
export declare function calculateWorkedHours(punchIn: Date, punchOut: Date, breakDurationMinutes: number): number;
export declare function calculateExtraHours(workedHours: number, scheduledHours: number): number;
export declare function scheduledHoursFromShift(shift: ShiftTiming): number;
export declare function isShiftCutoffPassed(attendanceDate: string, shift: ShiftTiming, now?: Date): boolean;
export declare function isoDateOnly(d: Date): string;
export declare function eachDateInclusive(from: string, to: string): string[];
export declare const DAY_NAMES: readonly ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export declare function dayNameForDate(isoDate: string): string;

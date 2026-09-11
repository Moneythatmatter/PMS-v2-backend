export type ExcludedDate = {
    date: string;
    reason: "HOLIDAY" | "WEEKLY_OFF";
    holidayId?: string | null;
};
export type PerDateLeaveBreakdown = {
    date: string;
    dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF";
    consumesLeave: boolean;
    holidayId?: string | null;
};
export type EffectiveLeaveResult = {
    calendarDates: string[];
    calendarDays: number;
    eligibleDates: string[];
    excluded: ExcludedDate[];
    effectiveDays: number;
    perDate: PerDateLeaveBreakdown[];
};
export type EffectiveLeaveInput = {
    propertyId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    durationOption?: string;
};
/** Pure builder for tests — classifications must be pre-fetched per date. */
export declare function buildEffectiveLeaveFromClassifications(calendarDates: string[], classifications: Map<string, {
    dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF";
    holidayId?: string | null;
}>, durationOption?: string, fromDate?: string, toDate?: string): EffectiveLeaveResult;
/** Backend authority for eligible leave dates (excludes holidays & weekly offs by default). */
export declare function calculateEffectiveLeaveDates(input: EffectiveLeaveInput): Promise<EffectiveLeaveResult>;

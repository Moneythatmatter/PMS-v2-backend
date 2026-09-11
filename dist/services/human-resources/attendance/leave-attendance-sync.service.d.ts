import type { EffectiveLeaveResult } from "../leave/leave-effective-days.service.js";
export type LeaveApplicationSyncRow = {
    id: string;
    propertyId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    status: string;
};
/** Sync all dates in an approved leave range to attendance (LEAVE / HOLIDAY / WEEKLY_OFF). */
export declare function syncLeaveToAttendance(propertyId: string, leaveApplicationId: string, effective: EffectiveLeaveResult, changedBy?: string): Promise<number>;
/** Recalculate dates removed from leave coverage (cancel / reduce / date change). */
export declare function recalculateDatesAfterLeaveChange(propertyId: string, employeeId: string, dates: string[], changedBy?: string): Promise<number>;
/** Differential sync: only touch added/removed dates. */
export declare function syncLeaveApplicationDiff(input: {
    propertyId: string;
    leaveApplicationId: string;
    oldEffective: EffectiveLeaveResult;
    newEffective: EffectiveLeaveResult;
    changedBy?: string;
}): Promise<{
    synced: number;
    recalculated: number;
}>;
export declare function recalculateAllDatesInRange(propertyId: string, employeeId: string, fromDate: string, toDate: string, changedBy?: string): Promise<number>;
/** @deprecated Use syncLeaveToAttendance from leave-attendance-sync.service */
export declare function syncApprovedLeaveToAttendance(propertyId: string, leaveApplicationId: string, changedBy?: string): Promise<number>;

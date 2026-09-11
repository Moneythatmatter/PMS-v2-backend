export type LeaveApplicationRow = {
    id: string;
    propertyId: string;
    employeeId: string;
    leaveTypeId?: string | null;
    leaveTypeCode?: string | null;
    leaveTypeName?: string | null;
    durationOption?: string | null;
    fromDate: string;
    toDate: string;
    status: string;
    effectiveDays?: number | null;
    consumedDates?: string[] | null;
    excludedDates?: unknown[] | null;
    calendarDays?: number | null;
    totalDays?: number | null;
    approvedBy?: string | null;
};
export declare function previewLeaveDays(input: {
    propertyId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    durationOption?: string;
}): Promise<import("./leave-effective-days.service.js").EffectiveLeaveResult>;
export declare function approveLeave(input: {
    propertyId: string;
    leaveRequestId: string;
    approvedBy?: string;
}): Promise<Record<string, unknown>>;
export declare function cancelLeave(input: {
    propertyId: string;
    leaveRequestId: string;
    changedBy?: string;
    newToDate?: string;
}): Promise<Record<string, unknown>>;
export declare function modifyLeave(input: {
    propertyId: string;
    leaveRequestId: string;
    fromDate: string;
    toDate: string;
    changedBy?: string;
    durationOption?: string;
}): Promise<Record<string, unknown>>;
export declare function enrichLeaveApplicationOnCreate(input: {
    propertyId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    durationOption?: string;
}): Promise<{
    calendarDays: number;
    totalDays: number;
    effectiveDays: null;
    consumedDates: never[];
    excludedDates: import("./leave-effective-days.service.js").ExcludedDate[];
}>;

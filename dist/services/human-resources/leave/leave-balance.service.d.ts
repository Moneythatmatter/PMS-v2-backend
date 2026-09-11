export type LeaveBalanceJson = {
    casual?: number;
    sick?: number;
    earned?: number;
    [key: string]: number | undefined;
};
export type BalanceTransactionType = "CONSUMED" | "RESTORED" | "ADJUSTED" | "OPENING" | "REVERSAL";
export declare function leaveTypeCodeToBucket(code?: string | null): keyof LeaveBalanceJson;
export declare function hasConsumptionTransaction(leaveRequestId: string): Promise<boolean>;
export declare function writeLeaveAudit(input: {
    propertyId: string;
    leaveRequestId: string;
    action: string;
    changedBy?: string;
    auditNotes?: string;
}): Promise<void>;
export declare function applyConsumption(input: {
    propertyId: string;
    employeeId: string;
    leaveTypeId?: string | null;
    leaveTypeCode?: string | null;
    leaveRequestId: string;
    effectiveDates: string[];
    days: number;
    createdBy?: string;
    remarks?: string;
}): Promise<{
    transactionId: string;
    balanceAfter: LeaveBalanceJson;
}>;
export declare function applyRestoration(input: {
    propertyId: string;
    employeeId: string;
    leaveTypeId?: string | null;
    leaveTypeCode?: string | null;
    leaveRequestId: string;
    effectiveDates: string[];
    days: number;
    createdBy?: string;
    remarks?: string;
}): Promise<{
    transactionId: string;
    balanceAfter: LeaveBalanceJson;
}>;
export declare function applyDifferential(input: {
    propertyId: string;
    employeeId: string;
    leaveTypeId?: string | null;
    leaveTypeCode?: string | null;
    leaveRequestId: string;
    oldEffectiveDays: number;
    newEffectiveDays: number;
    restoredDates: string[];
    consumedDates: string[];
    createdBy?: string;
    remarks?: string;
}): Promise<{
    restored: number;
    consumed: number;
    balanceAfter: LeaveBalanceJson;
}>;

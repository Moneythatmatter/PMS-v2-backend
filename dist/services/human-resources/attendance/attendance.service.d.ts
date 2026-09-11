import { findApprovedLeaveForDate } from "./calendar-resolver.js";
import { isShiftCutoffPassed } from "./time-calculator.js";
export type AttendanceRecordRow = {
    id: string;
    propertyId: string;
    employeeId: string;
    shiftId?: string;
    attendanceDate: string;
    dayType: string;
    holidayId?: string | null;
    attendanceStatus: string;
    punchIn?: string | null;
    punchOut?: string | null;
    scheduledHours?: number;
    workedHours?: number;
    extraHours?: number;
    holidayWorked?: boolean;
    leaveRequestId?: string | null;
    remarks?: string | null;
    source?: string;
    createdBy?: string;
    updatedBy?: string;
};
export type AttendanceAuditInput = {
    propertyId: string;
    attendanceId: string;
    action: string;
    changedBy?: string;
    auditNotes?: string;
    overrideReason?: string;
};
declare const PROTECTED_STATUSES: Set<string>;
/** Resolve working-day status — PENDING until shift cutoff when no punch. */
export declare function resolveWorkingDayAttendanceStatus(input: {
    hasPunch: boolean;
    cutoffPassed: boolean;
    approvedLeaveId?: string | null;
}): {
    attendanceStatus: string;
    leaveRequestId: string | null;
};
declare function shouldReplaceForCalendarStatus(status?: string): boolean;
export declare function recalculateAttendanceForDate(propertyId: string, employeeId: string, attendanceDate: string, options?: {
    changedBy?: string;
    clearLeaveLink?: boolean;
    now?: Date;
}): Promise<AttendanceRecordRow | null>;
export declare function writeAttendanceAudit(input: AttendanceAuditInput): Promise<void>;
export declare function getEmployeeForProperty(employeeId: string, propertyId: string): Promise<{
    id: string;
    propertyId: string;
    status: string;
} | null>;
export declare function findDailyRecord(propertyId: string, employeeId: string, attendanceDate: string): Promise<AttendanceRecordRow | null>;
export declare function upsertDailyRecord(input: Partial<AttendanceRecordRow> & {
    propertyId: string;
    employeeId: string;
    attendanceDate: string;
}, options?: {
    changedBy?: string;
    auditAction?: string;
    overrideReason?: string;
}): Promise<AttendanceRecordRow>;
export declare function punchIn(input: {
    propertyId: string;
    employeeId: string;
    attendanceDate?: string;
    punchInAt?: string;
    source?: string;
    changedBy?: string;
    remarks?: string;
}): Promise<AttendanceRecordRow>;
export declare function punchOut(input: {
    propertyId: string;
    employeeId: string;
    attendanceDate?: string;
    punchOutAt?: string;
    source?: string;
    changedBy?: string;
    remarks?: string;
}): Promise<AttendanceRecordRow>;
export declare function correctAttendance(input: {
    propertyId: string;
    attendanceId: string;
    punchIn?: string | null;
    punchOut?: string | null;
    attendanceStatus?: string;
    remarks?: string;
    changedBy?: string;
    overrideReason: string;
}): Promise<AttendanceRecordRow>;
export declare function recalculateAttendance(propertyId: string, attendanceId: string, changedBy?: string): Promise<AttendanceRecordRow>;
export { PROTECTED_STATUSES, isShiftCutoffPassed, findApprovedLeaveForDate, shouldReplaceForCalendarStatus };

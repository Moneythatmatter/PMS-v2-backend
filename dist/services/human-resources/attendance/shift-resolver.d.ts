import { type ShiftTiming } from "./time-calculator.js";
export type ShiftTypeRow = {
    id: string;
    propertyId: string;
    shiftCode: string;
    shiftName: string;
    startTime?: string;
    endTime?: string;
    breakDurationMinutes?: number;
    totalWorkingHours?: number;
    isNightShift?: boolean;
    status?: string;
};
export type ShiftAssignmentRow = {
    id: string;
    employeeId: string;
    shiftTypeId?: string;
    shiftCode?: string;
    shiftName?: string;
    startTime?: string;
    endTime?: string;
    effectiveFrom: string;
    effectiveTo?: string;
    status?: string;
};
export type EmployeeRow = {
    id: string;
    propertyId: string;
    shiftTypeId?: string;
    status?: string;
};
export declare function resolveShiftForEmployee(employeeId: string, attendanceDate: string): Promise<{
    shiftId: string;
    timing: ShiftTiming;
    shiftCode: string;
    shiftName: string;
}>;
export declare function scheduledHoursForShift(timing: ShiftTiming): number;
export declare function defaultPunchInForShift(attendanceDate: string, timing: ShiftTiming): Date;

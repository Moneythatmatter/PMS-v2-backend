import { type WeeklyOffAssignment } from "../weekly-off/weekly-off.service.js";
export type HolidayRow = {
    id: string;
    propertyId: string;
    holidayName: string;
    holidayDate: string;
    status?: string;
};
export type WeeklyOffRow = WeeklyOffAssignment;
export type LeaveApplicationRow = {
    id: string;
    employeeId: string;
    propertyId: string;
    fromDate: string;
    toDate: string;
    status: string;
};
export declare function findHolidayForDate(propertyId: string, attendanceDate: string): Promise<HolidayRow | null>;
export declare function isWeeklyOffForEmployee(propertyId: string, employeeId: string, attendanceDate: string): Promise<boolean>;
export { resolveWeeklyOffForDate } from "../weekly-off/weekly-off.service.js";
export declare function findApprovedLeaveForDate(employeeId: string, attendanceDate: string): Promise<LeaveApplicationRow | null>;
export type DayClassification = {
    dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF";
    holidayId: string | null;
    holidayName: string | null;
    isWeeklyOff: boolean;
    approvedLeave: LeaveApplicationRow | null;
};
/** Classify a date without considering punches. Leave on holiday/week-off is excluded per policy. */
export declare function classifyDay(propertyId: string, employeeId: string, attendanceDate: string): Promise<DayClassification>;
export declare function datesForApprovedLeave(app: LeaveApplicationRow): string[];

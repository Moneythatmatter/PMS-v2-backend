import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import {
  resolveWeeklyOffForDate,
  type WeeklyOffAssignment,
} from "../weekly-off/weekly-off.service.js";
import { eachDateInclusive } from "./time-calculator.js";

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

export async function findHolidayForDate(
  propertyId: string,
  attendanceDate: string,
): Promise<HolidayRow | null> {
  const rows = await hrModel.list<HolidayRow>(hrTables.holidays, {
    filters: { property_id: propertyId, holiday_date: attendanceDate, status: "Active" },
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function isWeeklyOffForEmployee(
  propertyId: string,
  employeeId: string,
  attendanceDate: string,
): Promise<boolean> {
  const resolved = await resolveWeeklyOffForDate({ propertyId, employeeId, date: attendanceDate });
  return resolved.isWeeklyOff;
}

export { resolveWeeklyOffForDate } from "../weekly-off/weekly-off.service.js";

export async function findApprovedLeaveForDate(
  employeeId: string,
  attendanceDate: string,
): Promise<LeaveApplicationRow | null> {
  const apps = await hrModel.list<LeaveApplicationRow>(hrTables.leaveApplications, {
    filters: { employee_id: employeeId, status: "Approved" },
  });
  for (const app of apps) {
    const from = app.fromDate.slice(0, 10);
    const to = app.toDate.slice(0, 10);
    if (attendanceDate >= from && attendanceDate <= to) {
      return app;
    }
  }
  return null;
}

export type DayClassification = {
  dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF";
  holidayId: string | null;
  holidayName: string | null;
  isWeeklyOff: boolean;
  approvedLeave: LeaveApplicationRow | null;
};

/** Classify a date without considering punches. Leave on holiday/week-off is excluded per policy. */
export async function classifyDay(
  propertyId: string,
  employeeId: string,
  attendanceDate: string,
): Promise<DayClassification> {
  const holiday = await findHolidayForDate(propertyId, attendanceDate);
  const weeklyOff = await isWeeklyOffForEmployee(propertyId, employeeId, attendanceDate);

  if (holiday) {
    return {
      dayType: "HOLIDAY",
      holidayId: holiday.id,
      holidayName: holiday.holidayName,
      isWeeklyOff: weeklyOff,
      approvedLeave: null,
    };
  }

  if (weeklyOff) {
    return {
      dayType: "WEEKLY_OFF",
      holidayId: null,
      holidayName: null,
      isWeeklyOff: true,
      approvedLeave: null,
    };
  }

  const approvedLeave = await findApprovedLeaveForDate(employeeId, attendanceDate);
  return {
    dayType: "WORKING_DAY",
    holidayId: null,
    holidayName: null,
    isWeeklyOff: false,
    approvedLeave,
  };
}

export function datesForApprovedLeave(app: LeaveApplicationRow): string[] {
  return eachDateInclusive(app.fromDate, app.toDate);
}

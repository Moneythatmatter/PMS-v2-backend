import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { findDailyRecord } from "../human-resources/attendance/attendance.service.js";
import { enrichAttendanceRecords } from "../human-resources/attendance/enrich.js";
import { enrichEmployee } from "../human-resources/enrich.js";
import {
  buildUpcomingBirthdays,
  buildUpcomingHolidays,
} from "../human-resources/upcoming-events.service.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthRange(ref = new Date()): { fromDate: string; toDate: string } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

function activeShiftAssignment<
  T extends { effectiveFrom: string; effectiveTo?: string | null; status?: string },
>(rows: T[], date: string): T | null {
  const d = date.slice(0, 10);
  const active = rows.filter((r) => {
    if (r.status && r.status !== "Active") return false;
    const from = r.effectiveFrom.slice(0, 10);
    const to = r.effectiveTo?.slice(0, 10);
    if (d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  active.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return active[0] ?? null;
}

export async function getEmployeeDashboard(input: {
  propertyId: string;
  employeeId: string;
}) {
  const { propertyId, employeeId } = input;
  const date = todayIso();
  const { fromDate, toDate } = monthRange();

  const [
    employeeRaw,
    todayRecord,
    monthRows,
    leaveRows,
    otRows,
    payslipRows,
    shiftRows,
    colleagueRows,
    deptRows,
    holidayRows,
  ] = await Promise.all([
    hrModel.get(hrTables.employees, employeeId),
    findDailyRecord(propertyId, employeeId, date),
    hrModel.list(hrTables.attendanceRecords, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "attendance_date",
      ascending: false,
    }),
    hrModel.list(hrTables.leaveApplications, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "applied_on",
      ascending: false,
      limit: 50,
    }),
    hrModel.list(hrTables.overtimeRecords, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "record_date",
      ascending: false,
      limit: 20,
    }),
    hrModel.list(hrTables.payslips, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "generated_date",
      ascending: false,
      limit: 1,
    }),
    hrModel.list(hrTables.shiftAssignments, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "effective_from",
      ascending: false,
    }),
    hrModel.list<{
      id: string;
      firstName?: string;
      lastName?: string;
      dob?: string | null;
      avatar?: string | null;
      departmentId?: string | null;
      status?: string;
    }>(hrTables.employees, {
      filters: { property_id: propertyId, status: "Active" },
    }),
    hrModel.list<{ id: string; departmentName: string }>(hrTables.departments, {
      filters: { property_id: propertyId },
    }),
    hrModel.list<{
      id: string;
      holidayName: string;
      holidayDate: string;
      dayOfWeek?: string;
      category?: string;
      status?: string;
    }>(hrTables.holidays, {
      filters: { property_id: propertyId, status: "Active" },
      orderBy: "holiday_date",
      ascending: true,
    }),
  ]);

  const employee = employeeRaw ? await enrichEmployee(employeeRaw as Parameters<typeof enrichEmployee>[0]) : null;

  const monthFiltered = (monthRows as { attendanceDate?: string }[]).filter((r) => {
    const d = r.attendanceDate?.slice(0, 10) ?? "";
    return d >= fromDate && d <= toDate;
  });

  const presentCount = monthFiltered.filter((r) =>
    ["Present", "Late", "Half Day"].includes(String((r as { attendanceStatus?: string }).attendanceStatus ?? "")),
  ).length;

  const leavePending = (leaveRows as { status?: string }[]).filter((r) => r.status === "Pending");
  const otPending = (otRows as { status?: string }[]).filter((r) => r.status === "Pending");
  const otApproved = (otRows as { status?: string }[]).filter((r) => r.status === "Approved");

  const todayShift = activeShiftAssignment(
    shiftRows as Array<{ effectiveFrom: string; effectiveTo?: string | null; status?: string }>,
    date,
  );

  let todayAttendance = null;
  if (todayRecord) {
    const enriched = await enrichAttendanceRecords([todayRecord as Record<string, unknown>]);
    todayAttendance = enriched[0] ?? null;
  }

  const deptLookup = new Map(deptRows.map((d) => [d.id, d.departmentName]));
  const refDate = new Date(`${date}T12:00:00`);
  const upcomingBirthdays = buildUpcomingBirthdays(colleagueRows, {
    fromDate: refDate,
    daysAhead: 60,
    departmentLookup: deptLookup,
  }).slice(0, 8);
  const upcomingHolidays = buildUpcomingHolidays(holidayRows, {
    fromDate: refDate,
    daysAhead: 365,
  }).slice(0, 5);

  return {
    date,
    employee: employee
      ? {
          id: employee.id,
          empCode: employee.empCode,
          name: employee.name,
          department: employee.department,
          designation: employee.designation,
          shiftType: employee.shiftType,
          leaveBalance: employee.leaveBalance,
        }
      : null,
    todayShift,
    todayAttendance,
    monthlySummary: {
      fromDate,
      toDate,
      totalDays: monthFiltered.length,
      presentDays: presentCount,
      records: monthFiltered.length,
    },
    leaveBalance: employee?.leaveBalance ?? { casual: 0, sick: 0, earned: 0 },
    pendingLeaveRequests: leavePending.slice(0, 5),
    pendingLeaveCount: leavePending.length,
    latestPayslip: (payslipRows as unknown[])[0] ?? null,
    overtime: {
      pending: otPending.slice(0, 5),
      pendingCount: otPending.length,
      approvedCount: otApproved.length,
    },
    upcomingBirthdays,
    upcomingHolidays,
  };
}

export function toEmployeeProfile(employee: Record<string, unknown>) {
  return {
    id: employee.id,
    empCode: employee.empCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    name: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
    email: employee.email,
    phone: employee.phone,
    gender: employee.gender,
    dob: employee.dob,
    address: employee.address,
    joinDate: employee.joinDate,
    status: employee.status,
    department: employee.department,
    designation: employee.designation,
    employmentType: employee.employmentType,
    shiftType: employee.shiftType,
    reportingManager: employee.reportingManager,
    emergencyContact: employee.emergencyContact,
    bloodGroup: employee.bloodGroup,
    bankAccount: employee.bankAccount,
    bankName: employee.bankName,
    ifscCode: employee.ifscCode,
    panNumber: employee.panNumber,
    uanNumber: employee.uanNumber,
    esicNumber: employee.esicNumber,
    leaveBalance: employee.leaveBalance,
    avatar: employee.avatar,
    photoUrl: employee.photoUrl,
  };
}

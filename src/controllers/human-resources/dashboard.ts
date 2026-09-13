import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import {
  buildUpcomingAnniversaries,
  buildUpcomingBirthdays,
  buildUpcomingHolidays,
} from "../../services/human-resources/upcoming-events.service.js";
import { fromError, ok } from "../../utils/response.js";

type EmployeeRow = {
  id: string;
  status: string;
  joinDate?: string;
  dob?: string | null;
  firstName?: string;
  lastName?: string;
  avatar?: string | null;
  gender?: string;
  designationId?: string;
  departmentId?: string;
};

type AttendanceRow = {
  attendanceDate: string;
  recordDate?: string;
  attendanceStatus: string;
  status?: string;
  employeeId: string;
  remarks?: string;
};

function attendanceDateOf(row: AttendanceRow): string {
  return (row.attendanceDate ?? row.recordDate ?? "").slice(0, 10);
}

function isPresentStatus(status: string, remarks?: string): boolean {
  const normalized = status.toUpperCase();
  if (normalized === "PRESENT" || status === "Present" || status === "Late") return true;
  if (normalized === "PRESENT" && remarks?.toLowerCase().includes("late")) return true;
  return status === "Late";
}

function isLeaveStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized === "LEAVE" || status === "On Leave";
}

type LeaveRow = {
  status: string;
  fromDate?: string;
  toDate?: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function nextMonthStart(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

function dateInRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

export async function getDashboard(_req: ContextRequest, res: Response) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const monthFrom = monthStart(today);
    const monthToExclusive = nextMonthStart(today);

    const [employees, leaveApps, payroll, complaints, depts, designations, attendance, holidays] =
      await Promise.all([
        hrModel.list<EmployeeRow>(hrTables.employees),
        hrModel.list<LeaveRow>(hrTables.leaveApplications),
        hrModel.list<{ status: string; netSalary: number; grossSalary: number; deductionsTotal: number }>(
          hrTables.payrollRecords,
        ),
        hrModel.list<{ status: string }>(hrTables.complaints),
        hrModel.list<{ id: string; departmentName: string }>(hrTables.departments),
        hrModel.list<{ id: string; designationTitle: string; departmentId?: string }>(hrTables.designations),
        hrModel.list<AttendanceRow>(hrTables.attendanceRecords, { orderBy: "attendance_date" }),
        hrModel.list<{
          id: string;
          holidayName: string;
          holidayDate: string;
          dayOfWeek?: string;
          category?: string;
          status?: string;
        }>(hrTables.holidays, { orderBy: "holiday_date", ascending: true }),
      ]);

    const totalEmployees = employees.length;
    const activeEmployees = employees.filter((e) => e.status === "Active").length;
    const pendingLeaves = leaveApps.filter((l) => l.status === "Pending").length;
    const processedPayroll = payroll.filter((p) => p.status !== "Draft").length;
    const pendingPayroll = payroll.filter((p) => p.status === "Draft" || p.status === "Calculated").length;
    const grossPayroll = payroll.reduce((s, p) => s + Number(p.grossSalary ?? 0), 0);
    const totalDeductions = payroll.reduce((s, p) => s + Number(p.deductionsTotal ?? 0), 0);

    const newJoineesThisMonth = employees.filter((e) => {
      const jd = e.joinDate?.slice(0, 10);
      return jd && jd >= monthFrom && jd < monthToExclusive;
    }).length;

    const deptCounts = await Promise.all(
      depts.map(async (d) => {
        const emps = await hrModel.list(hrTables.employees, {
          filters: { department_id: d.id },
        });
        return { department: d.departmentName, count: emps.length };
      }),
    );

    const desigLookup = new Map(designations.map((d) => [d.id, d]));
    const deptLookup = new Map(depts.map((d) => [d.id, d.departmentName]));

    const desigCountsMap = new Map<string, { designation: string; department: string; count: number }>();
    for (const emp of employees) {
      if (!emp.designationId) continue;
      const desig = desigLookup.get(emp.designationId);
      if (!desig) continue;
      const deptName =
        (emp.departmentId ? deptLookup.get(emp.departmentId) : undefined) ??
        (desig.departmentId ? deptLookup.get(desig.departmentId) : undefined) ??
        "";
      const key = desig.id;
      const existing = desigCountsMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        desigCountsMap.set(key, {
          designation: desig.designationTitle,
          department: deptName,
          count: 1,
        });
      }
    }

    const designationHeadcounts = Array.from(desigCountsMap.values()).sort((a, b) =>
      a.designation.localeCompare(b.designation),
    );

    const male = employees.filter((e) => e.gender === "Male").length;
    const female = employees.filter((e) => e.gender === "Female").length;
    const other = employees.filter(
      (e) => e.gender && e.gender !== "Male" && e.gender !== "Female",
    ).length;

    const attendanceDates = [...new Set(attendance.map((a) => attendanceDateOf(a)).filter(Boolean))].sort();
    const focusDate =
      attendance.some((a) => attendanceDateOf(a) === todayStr)
        ? todayStr
        : attendanceDates[attendanceDates.length - 1] ?? todayStr;

    const dayRecords = attendance.filter((a) => attendanceDateOf(a) === focusDate);
    const isLate = (r: AttendanceRow) =>
      r.status === "Late" || Boolean(r.remarks?.toLowerCase().includes("late"));
    const isPresent = (r: AttendanceRow) => {
      const s = (r.attendanceStatus ?? r.status ?? "").toUpperCase();
      return s === "PRESENT" || r.status === "Present" || r.status === "Late" || isLate(r);
    };
    const presentCount = dayRecords.filter((r) => isPresent(r) && !isLate(r)).length;
    const lateArrivals = dayRecords.filter(isLate).length;
    const onLeaveFromAttendance = dayRecords.filter((r) => isLeaveStatus(r.attendanceStatus ?? r.status ?? "")).length;

    const onLeaveApproved = leaveApps.filter(
      (l) =>
        l.status === "Approved" &&
        l.fromDate &&
        l.toDate &&
        dateInRange(focusDate, l.fromDate.slice(0, 10), l.toDate.slice(0, 10)),
    ).length;

    const onLeaveCount = Math.max(onLeaveFromAttendance, onLeaveApproved);
    const markedCount = dayRecords.length;
    const absent = Math.max(0, activeEmployees - markedCount + onLeaveFromAttendance);

    const weeklyTrend: { day: string; present: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const label = DAY_LABELS[d.getDay()];
      const count = attendance.filter(
        (a) =>
          attendanceDateOf(a) === iso &&
          isPresentStatus(a.attendanceStatus ?? a.status ?? "", a.remarks),
      ).length;
      weeklyTrend.push({ day: label, present: count });
    }

    const attendanceRate =
      activeEmployees > 0
        ? Math.round(((presentCount + lateArrivals) / activeEmployees) * 1000) / 10
        : 0;

    const upcomingBirthdays = buildUpcomingBirthdays(employees, {
      fromDate: today,
      daysAhead: 60,
      departmentLookup: deptLookup,
    });
    const upcomingAnniversaries = buildUpcomingAnniversaries(employees, {
      fromDate: today,
      daysAhead: 60,
      departmentLookup: deptLookup,
    });
    const upcomingHolidays = buildUpcomingHolidays(holidays, {
      fromDate: today,
      daysAhead: 120,
    });

    return ok(res, {
      kpi: {
        totalEmployees,
        activeEmployees,
        newJoineesThisMonth,
        presentCount: presentCount + lateArrivals,
        attendanceRate,
        onLeaveCount,
        pendingLeaveRequestsCount: pendingLeaves,
        payrollProcessedCount: processedPayroll,
        payrollPendingCount: pendingPayroll,
        payCycleDate: today.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      },
      attendanceBreakdown: {
        present: presentCount,
        absent,
        onLeave: onLeaveCount,
        lateArrivals,
        focusDate,
      },
      weeklyTrend,
      departmentHeadcounts: deptCounts,
      designationHeadcounts,
      genderDistribution: {
        male,
        female,
        other,
        total: totalEmployees,
      },
      grievances: {
        open: complaints.filter((c) => c.status === "Submitted" || c.status === "Open").length,
        inProgress: complaints.filter((c) => c.status === "In Progress").length,
        escalated: complaints.filter((c) => c.status === "Escalated").length,
        resolved: complaints.filter((c) => c.status === "Resolved" || c.status === "Closed").length,
      },
      payrollSummary: {
        grossPayroll,
        totalDeductions,
        netPayroll: grossPayroll - totalDeductions,
      },
      upcomingBirthdays,
      upcomingAnniversaries,
      upcomingHolidays,
    });
  } catch (e) {
    return fromError(res, e);
  }
}

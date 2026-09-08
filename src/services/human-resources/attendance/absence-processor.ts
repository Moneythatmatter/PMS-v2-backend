import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { classifyDay, findApprovedLeaveForDate } from "./calendar-resolver.js";
import {
  findDailyRecord,
  getEmployeeForProperty,
  isShiftCutoffPassed,
  recalculateAttendanceForDate,
  shouldReplaceForCalendarStatus,
  upsertDailyRecord,
} from "./attendance.service.js";
import { resolveShiftForEmployee } from "./shift-resolver.js";

export type AbsenceProcessResult = {
  processed: number;
  created: number;
  skipped: number;
  date: string;
};

async function isLeaveStillValid(
  employeeId: string,
  date: string,
  leaveRequestId?: string | null,
): Promise<boolean> {
  const live = await findApprovedLeaveForDate(employeeId, date);
  if (!live) return false;
  if (leaveRequestId && live.id !== leaveRequestId) return false;
  return true;
}

export async function processAbsenceForProperty(
  propertyId: string,
  options?: { attendanceDate?: string; now?: Date },
): Promise<AbsenceProcessResult> {
  const date = (options?.attendanceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const now = options?.now ?? new Date();

  const employees = await hrModel.list<{ id: string; propertyId: string; status: string }>(
    hrTables.employees,
    { filters: { property_id: propertyId, status: "Active" } },
  );

  let created = 0;
  let skipped = 0;

  for (const emp of employees) {
    if (emp.propertyId !== propertyId) continue;

    const existing = await findDailyRecord(propertyId, emp.id, date);

    if (existing?.attendanceStatus === "LEAVE") {
      const valid = await isLeaveStillValid(emp.id, date, existing.leaveRequestId);
      if (!valid) {
        await recalculateAttendanceForDate(propertyId, emp.id, date, {
          clearLeaveLink: true,
          now,
        });
        created++;
        continue;
      }
      skipped++;
      continue;
    }

    if (
      existing &&
      (existing.attendanceStatus === "PRESENT" ||
        existing.attendanceStatus === "HOLIDAY" ||
        existing.attendanceStatus === "WEEKLY_OFF")
    ) {
      skipped++;
      continue;
    }

    const classification = await classifyDay(propertyId, emp.id, date);

    if (classification.dayType === "HOLIDAY") {
      if (!existing || shouldReplaceForCalendarStatus(existing.attendanceStatus)) {
        await upsertDailyRecord({
          propertyId,
          employeeId: emp.id,
          attendanceDate: date,
          dayType: "HOLIDAY",
          holidayId: classification.holidayId,
          attendanceStatus: existing?.punchIn ? "PRESENT" : "HOLIDAY",
          holidayWorked: Boolean(existing?.punchIn),
          leaveRequestId: null,
          punchIn: existing?.punchIn ?? null,
          punchOut: existing?.punchOut ?? null,
          source: "IMPORT",
        });
        created++;
      } else {
        skipped++;
      }
      continue;
    }

    if (classification.dayType === "WEEKLY_OFF") {
      if (!existing || shouldReplaceForCalendarStatus(existing.attendanceStatus)) {
        await upsertDailyRecord({
          propertyId,
          employeeId: emp.id,
          attendanceDate: date,
          dayType: "WEEKLY_OFF",
          attendanceStatus: existing?.punchIn ? "PRESENT" : "WEEKLY_OFF",
          holidayWorked: false,
          leaveRequestId: null,
          punchIn: existing?.punchIn ?? null,
          punchOut: existing?.punchOut ?? null,
          source: "IMPORT",
        });
        created++;
      } else {
        skipped++;
      }
      continue;
    }

    if (classification.approvedLeave) {
      if (!existing || existing.attendanceStatus !== "LEAVE") {
        await upsertDailyRecord({
          propertyId,
          employeeId: emp.id,
          attendanceDate: date,
          dayType: "WORKING_DAY",
          attendanceStatus: "LEAVE",
          leaveRequestId: classification.approvedLeave.id,
          punchIn: null,
          punchOut: null,
          source: "IMPORT",
        });
        created++;
      } else {
        skipped++;
      }
      continue;
    }

    const { timing } = await resolveShiftForEmployee(emp.id, date);
    if (!isShiftCutoffPassed(date, timing, now)) {
      skipped++;
      continue;
    }

    if (existing?.punchIn) {
      skipped++;
      continue;
    }

    if (existing?.attendanceStatus === "ABSENT") {
      skipped++;
      continue;
    }

    await upsertDailyRecord({
      propertyId,
      employeeId: emp.id,
      attendanceDate: date,
      dayType: "WORKING_DAY",
      attendanceStatus: "ABSENT",
      leaveRequestId: null,
      punchIn: null,
      punchOut: null,
      source: "IMPORT",
    });
    created++;
  }

  return {
    processed: employees.length,
    created,
    skipped,
    date,
  };
}

export { syncLeaveToAttendance, syncApprovedLeaveToAttendance } from "./leave-attendance-sync.service.js";

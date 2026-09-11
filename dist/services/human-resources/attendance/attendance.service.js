import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { newId } from "../../../models/front-office/base.js";
import { classifyDay, findApprovedLeaveForDate } from "./calendar-resolver.js";
import { resolveShiftForEmployee, scheduledHoursForShift, } from "./shift-resolver.js";
import { calculateExtraHours, calculateWorkedHours, isShiftCutoffPassed, } from "./time-calculator.js";
const PROTECTED_STATUSES = new Set(["PRESENT", "LEAVE", "HOLIDAY", "WEEKLY_OFF"]);
function conflictRemark(existing) {
    const base = existing ?? "";
    if (base.toLowerCase().includes("conflict"))
        return base;
    return `${base} Conflict: worked on approved leave day.`.trim();
}
/** Resolve working-day status — PENDING until shift cutoff when no punch. */
export function resolveWorkingDayAttendanceStatus(input) {
    if (input.approvedLeaveId && !input.hasPunch) {
        return { attendanceStatus: "LEAVE", leaveRequestId: input.approvedLeaveId };
    }
    if (input.hasPunch) {
        return {
            attendanceStatus: "PRESENT",
            leaveRequestId: input.approvedLeaveId ?? null,
        };
    }
    if (input.cutoffPassed) {
        return { attendanceStatus: "ABSENT", leaveRequestId: null };
    }
    return { attendanceStatus: "PENDING", leaveRequestId: null };
}
function shouldReplaceForCalendarStatus(status) {
    return !status || status === "PENDING" || status === "ABSENT";
}
export async function recalculateAttendanceForDate(propertyId, employeeId, attendanceDate, options) {
    const date = attendanceDate.slice(0, 10);
    const existing = await findDailyRecord(propertyId, employeeId, date);
    const hasPunch = Boolean(existing?.punchIn || existing?.punchOut);
    const classification = await classifyDay(propertyId, employeeId, date);
    const { shiftId, timing } = await resolveShiftForEmployee(employeeId, date);
    const scheduled = scheduledHoursForShift(timing);
    const now = options?.now ?? new Date();
    let dayType = classification.dayType;
    let holidayId = classification.holidayId;
    let attendanceStatus;
    let holidayWorked = false;
    let leaveRequestId = null;
    const liveLeave = options?.clearLeaveLink ? null : classification.approvedLeave;
    if (dayType === "HOLIDAY") {
        if (hasPunch) {
            attendanceStatus = "PRESENT";
            holidayWorked = true;
        }
        else {
            attendanceStatus = "HOLIDAY";
        }
    }
    else if (dayType === "WEEKLY_OFF") {
        attendanceStatus = hasPunch ? "PRESENT" : "WEEKLY_OFF";
    }
    else {
        const cutoffPassed = isShiftCutoffPassed(date, timing, now);
        const resolved = resolveWorkingDayAttendanceStatus({
            hasPunch,
            cutoffPassed,
            approvedLeaveId: liveLeave?.id ?? null,
        });
        attendanceStatus = resolved.attendanceStatus;
        leaveRequestId = resolved.leaveRequestId;
    }
    if (!existing && attendanceStatus === "PENDING") {
        return null;
    }
    const punchIn = existing?.punchIn ?? null;
    const punchOut = existing?.punchOut ?? null;
    const { workedHours, extraHours } = recalcFromPunches(punchIn, punchOut, timing, scheduled);
    let remarks = existing?.remarks ?? null;
    if (liveLeave && hasPunch && punchIn && punchOut) {
        remarks = conflictRemark(remarks);
    }
    return upsertDailyRecord({
        propertyId,
        employeeId,
        attendanceDate: date,
        shiftId: shiftId || undefined,
        dayType,
        holidayId,
        attendanceStatus,
        punchIn,
        punchOut,
        workedHours,
        extraHours,
        holidayWorked,
        leaveRequestId,
        remarks: remarks ?? undefined,
        source: existing?.source ?? "IMPORT",
    }, { changedBy: options?.changedBy, auditAction: "Recalculate Date" });
}
export async function writeAttendanceAudit(input) {
    await hrModel.create(hrTables.auditLogs, {
        id: newId(),
        propertyId: input.propertyId,
        module: "attendance",
        action: input.action,
        entityType: "attendance_record",
        entityId: input.attendanceId,
        changedBy: input.changedBy ?? "system",
        auditNotes: input.auditNotes,
        overrideReason: input.overrideReason,
    });
}
export async function getEmployeeForProperty(employeeId, propertyId) {
    const emp = await hrModel.get(hrTables.employees, employeeId);
    if (!emp || emp.propertyId !== propertyId)
        return null;
    return emp;
}
export async function findDailyRecord(propertyId, employeeId, attendanceDate) {
    const rows = await hrModel.list(hrTables.attendanceRecords, {
        filters: {
            property_id: propertyId,
            employee_id: employeeId,
            attendance_date: attendanceDate,
        },
        limit: 1,
    });
    return rows[0] ?? null;
}
async function baseFields(ctx) {
    const { shiftId, timing } = await resolveShiftForEmployee(ctx.employeeId, ctx.attendanceDate);
    const classification = await classifyDay(ctx.propertyId, ctx.employeeId, ctx.attendanceDate);
    const scheduled = scheduledHoursForShift(timing);
    let dayType = classification.dayType;
    let holidayId = classification.holidayId;
    let attendanceStatus;
    let holidayWorked = false;
    let leaveRequestId = classification.approvedLeave?.id ?? null;
    if (classification.approvedLeave && dayType === "WORKING_DAY") {
        if (!ctx.hasPunch) {
            attendanceStatus = "LEAVE";
        }
        else {
            attendanceStatus = "PRESENT";
            leaveRequestId = classification.approvedLeave.id;
        }
    }
    else if (dayType === "HOLIDAY") {
        if (ctx.hasPunch) {
            attendanceStatus = "PRESENT";
            holidayWorked = true;
        }
        else {
            attendanceStatus = "HOLIDAY";
            holidayWorked = false;
        }
    }
    else if (dayType === "WEEKLY_OFF") {
        if (ctx.hasPunch) {
            attendanceStatus = "PRESENT";
        }
        else {
            attendanceStatus = "WEEKLY_OFF";
        }
    }
    else if (ctx.hasPunch) {
        attendanceStatus = "PRESENT";
    }
    else {
        const cutoffPassed = isShiftCutoffPassed(ctx.attendanceDate, timing, new Date());
        attendanceStatus = cutoffPassed ? "ABSENT" : "PENDING";
    }
    return {
        shiftId: shiftId || null,
        scheduledHours: scheduled,
        dayType,
        holidayId,
        attendanceStatus,
        holidayWorked,
        leaveRequestId,
        timing,
        classification,
    };
}
function recalcFromPunches(punchIn, punchOut, timing, scheduledHours) {
    if (!punchIn || !punchOut) {
        return { workedHours: 0, extraHours: 0 };
    }
    const worked = calculateWorkedHours(new Date(punchIn), new Date(punchOut), timing.breakDurationMinutes);
    return {
        workedHours: worked,
        extraHours: calculateExtraHours(worked, scheduledHours),
    };
}
export async function upsertDailyRecord(input, options) {
    const date = input.attendanceDate.slice(0, 10);
    const hasPunch = Boolean(input.punchIn);
    const base = await baseFields({
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        attendanceDate: date,
        hasPunch: hasPunch || Boolean(input.punchOut),
    });
    const existing = await findDailyRecord(input.propertyId, input.employeeId, date);
    let punchIn = input.punchIn ?? existing?.punchIn ?? null;
    let punchOut = input.punchOut ?? existing?.punchOut ?? null;
    if (existing?.attendanceStatus === "LEAVE" && hasPunch && !input.punchOut) {
        if (!input.remarks?.toLowerCase().includes("conflict")) {
            input.remarks = conflictRemark(input.remarks ?? existing.remarks);
        }
    }
    const { workedHours, extraHours } = recalcFromPunches(punchIn, punchOut, base.timing, base.scheduledHours);
    let attendanceStatus = input.attendanceStatus ?? base.attendanceStatus;
    if (input.attendanceStatus === undefined) {
        if (punchIn && !punchOut) {
            if (base.dayType === "HOLIDAY")
                attendanceStatus = "PRESENT";
            else if (base.dayType === "WEEKLY_OFF")
                attendanceStatus = "PRESENT";
            else if (existing?.attendanceStatus === "LEAVE" || base.classification.approvedLeave)
                attendanceStatus = "LEAVE";
            else
                attendanceStatus = "PRESENT";
        }
        else if (punchIn && punchOut) {
            if (base.dayType === "HOLIDAY") {
                attendanceStatus = "PRESENT";
            }
            else if (base.classification.approvedLeave && base.dayType === "WORKING_DAY") {
                attendanceStatus = "PRESENT";
                if (!input.remarks?.toLowerCase().includes("conflict")) {
                    input.remarks = conflictRemark(input.remarks ?? existing?.remarks);
                }
            }
            else {
                attendanceStatus = "PRESENT";
            }
        }
    }
    let holidayWorked = input.holidayWorked ?? base.holidayWorked;
    if (base.dayType === "HOLIDAY" && punchIn)
        holidayWorked = true;
    const payload = {
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        shiftId: input.shiftId ?? base.shiftId,
        attendanceDate: date,
        dayType: input.dayType ?? base.dayType,
        holidayId: input.holidayId !== undefined ? input.holidayId : base.holidayId,
        attendanceStatus,
        punchIn,
        punchOut,
        scheduledHours: base.scheduledHours,
        workedHours: input.workedHours ?? workedHours,
        extraHours: input.extraHours ?? extraHours,
        holidayWorked,
        leaveRequestId: input.leaveRequestId !== undefined ? input.leaveRequestId : base.leaveRequestId,
        remarks: input.remarks ?? existing?.remarks ?? null,
        source: input.source ?? existing?.source ?? "MANUAL",
        updatedBy: options?.changedBy ?? input.updatedBy,
        updatedAt: new Date().toISOString(),
    };
    let row;
    if (existing) {
        row = await hrModel.update(hrTables.attendanceRecords, existing.id, payload);
        if (options?.auditAction) {
            await writeAttendanceAudit({
                propertyId: input.propertyId,
                attendanceId: existing.id,
                action: options.auditAction,
                changedBy: options.changedBy,
                overrideReason: options.overrideReason,
                auditNotes: `Updated attendance for ${date}`,
            });
        }
    }
    else {
        payload.createdBy = options?.changedBy ?? input.createdBy;
        payload.id = newId();
        row = await hrModel.create(hrTables.attendanceRecords, payload);
        if (options?.auditAction) {
            await writeAttendanceAudit({
                propertyId: input.propertyId,
                attendanceId: String(payload.id),
                action: options.auditAction,
                changedBy: options.changedBy,
                auditNotes: `Created attendance for ${date}`,
            });
        }
    }
    return row;
}
export async function punchIn(input) {
    const emp = await getEmployeeForProperty(input.employeeId, input.propertyId);
    if (!emp)
        throw new Error("Employee not found for this property");
    if (emp.status !== "Active")
        throw new Error("Employee is not active");
    const date = (input.attendanceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const punchInAt = input.punchInAt ?? new Date().toISOString();
    const existing = await findDailyRecord(input.propertyId, input.employeeId, date);
    if (existing?.punchIn) {
        throw new Error("Employee already punched in for this date");
    }
    return upsertDailyRecord({
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        attendanceDate: date,
        punchIn: punchInAt,
        punchOut: existing?.punchOut ?? null,
        source: input.source ?? "BIOMETRIC",
        remarks: input.remarks,
    }, { changedBy: input.changedBy, auditAction: "Punch In" });
}
export async function punchOut(input) {
    const emp = await getEmployeeForProperty(input.employeeId, input.propertyId);
    if (!emp)
        throw new Error("Employee not found for this property");
    const date = (input.attendanceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const existing = await findDailyRecord(input.propertyId, input.employeeId, date);
    if (!existing?.punchIn) {
        throw new Error("No punch-in found for this date. Punch in first.");
    }
    const punchOutAt = input.punchOutAt ?? new Date().toISOString();
    const punchInDate = new Date(existing.punchIn);
    const punchOutDate = new Date(punchOutAt);
    if (punchOutDate <= punchInDate) {
        throw new Error("Punch-out must be after punch-in");
    }
    return upsertDailyRecord({
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        attendanceDate: date,
        punchIn: existing.punchIn,
        punchOut: punchOutAt,
        source: input.source ?? existing.source ?? "BIOMETRIC",
        remarks: input.remarks ?? existing.remarks ?? undefined,
    }, { changedBy: input.changedBy, auditAction: "Punch Out" });
}
export async function correctAttendance(input) {
    const existing = await hrModel.get(hrTables.attendanceRecords, input.attendanceId);
    if (!existing || existing.propertyId !== input.propertyId) {
        throw new Error("Attendance record not found");
    }
    return upsertDailyRecord({
        propertyId: existing.propertyId,
        employeeId: existing.employeeId,
        attendanceDate: existing.attendanceDate,
        punchIn: input.punchIn !== undefined ? input.punchIn : existing.punchIn,
        punchOut: input.punchOut !== undefined ? input.punchOut : existing.punchOut,
        attendanceStatus: input.attendanceStatus ?? existing.attendanceStatus,
        remarks: input.remarks ?? existing.remarks ?? undefined,
        source: "MANUAL",
    }, {
        changedBy: input.changedBy,
        auditAction: "Manual Correction",
        overrideReason: input.overrideReason,
    });
}
export async function recalculateAttendance(propertyId, attendanceId, changedBy) {
    const existing = await hrModel.get(hrTables.attendanceRecords, attendanceId);
    if (!existing || existing.propertyId !== propertyId) {
        throw new Error("Attendance record not found");
    }
    const row = await recalculateAttendanceForDate(existing.propertyId, existing.employeeId, existing.attendanceDate, { changedBy });
    if (!row)
        throw new Error("Failed to recalculate attendance");
    return row;
}
export { PROTECTED_STATUSES, isShiftCutoffPassed, findApprovedLeaveForDate, shouldReplaceForCalendarStatus };
//# sourceMappingURL=attendance.service.js.map
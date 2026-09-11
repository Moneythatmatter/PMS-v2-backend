import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { findDailyRecord, getEmployeeForProperty, recalculateAttendanceForDate, upsertDailyRecord, } from "./attendance.service.js";
import { eachDateInclusive } from "./time-calculator.js";
function hasWork(existing) {
    if (!existing)
        return false;
    return Boolean(existing.punchIn) || existing.attendanceStatus === "PRESENT";
}
/** Sync all dates in an approved leave range to attendance (LEAVE / HOLIDAY / WEEKLY_OFF). */
export async function syncLeaveToAttendance(propertyId, leaveApplicationId, effective, changedBy) {
    const app = await hrModel.get(hrTables.leaveApplications, leaveApplicationId);
    if (!app || app.propertyId !== propertyId) {
        throw new Error("Leave application not found");
    }
    if (app.status !== "Approved") {
        throw new Error("Leave application is not approved");
    }
    const emp = await getEmployeeForProperty(app.employeeId, propertyId);
    if (!emp)
        throw new Error("Employee not found for this property");
    let count = 0;
    for (const day of effective.perDate) {
        const existing = await findDailyRecord(propertyId, app.employeeId, day.date);
        if (day.consumesLeave) {
            if (hasWork(existing))
                continue;
            await upsertDailyRecord({
                propertyId,
                employeeId: app.employeeId,
                attendanceDate: day.date,
                dayType: "WORKING_DAY",
                holidayId: null,
                attendanceStatus: "LEAVE",
                leaveRequestId: app.id,
                punchIn: null,
                punchOut: null,
                source: "IMPORT",
            }, { changedBy, auditAction: "Leave Sync" });
            count++;
            continue;
        }
        if (day.dayType === "HOLIDAY") {
            if (hasWork(existing)) {
                await upsertDailyRecord({
                    propertyId,
                    employeeId: app.employeeId,
                    attendanceDate: day.date,
                    dayType: "HOLIDAY",
                    holidayId: day.holidayId ?? null,
                    attendanceStatus: "PRESENT",
                    leaveRequestId: null,
                    punchIn: existing?.punchIn ?? null,
                    punchOut: existing?.punchOut ?? null,
                    holidayWorked: true,
                    source: existing?.source ?? "IMPORT",
                }, { changedBy, auditAction: "Leave Sync" });
            }
            else {
                await upsertDailyRecord({
                    propertyId,
                    employeeId: app.employeeId,
                    attendanceDate: day.date,
                    dayType: "HOLIDAY",
                    holidayId: day.holidayId ?? null,
                    attendanceStatus: "HOLIDAY",
                    leaveRequestId: null,
                    punchIn: null,
                    punchOut: null,
                    holidayWorked: false,
                    source: "IMPORT",
                }, { changedBy, auditAction: "Leave Sync" });
            }
            count++;
            continue;
        }
        if (day.dayType === "WEEKLY_OFF") {
            if (hasWork(existing)) {
                await upsertDailyRecord({
                    propertyId,
                    employeeId: app.employeeId,
                    attendanceDate: day.date,
                    dayType: "WEEKLY_OFF",
                    holidayId: null,
                    attendanceStatus: "PRESENT",
                    leaveRequestId: null,
                    punchIn: existing?.punchIn ?? null,
                    punchOut: existing?.punchOut ?? null,
                    source: existing?.source ?? "IMPORT",
                }, { changedBy, auditAction: "Leave Sync" });
            }
            else {
                await upsertDailyRecord({
                    propertyId,
                    employeeId: app.employeeId,
                    attendanceDate: day.date,
                    dayType: "WEEKLY_OFF",
                    holidayId: null,
                    attendanceStatus: "WEEKLY_OFF",
                    leaveRequestId: null,
                    punchIn: null,
                    punchOut: null,
                    source: "IMPORT",
                }, { changedBy, auditAction: "Leave Sync" });
            }
            count++;
        }
    }
    return count;
}
/** Recalculate dates removed from leave coverage (cancel / reduce / date change). */
export async function recalculateDatesAfterLeaveChange(propertyId, employeeId, dates, changedBy) {
    let count = 0;
    for (const date of dates) {
        await recalculateAttendanceForDate(propertyId, employeeId, date, {
            changedBy,
            clearLeaveLink: true,
        });
        count++;
    }
    return count;
}
/** Differential sync: only touch added/removed dates. */
export async function syncLeaveApplicationDiff(input) {
    const oldEligible = new Set(input.oldEffective.eligibleDates);
    const newEligible = new Set(input.newEffective.eligibleDates);
    const oldAll = new Set(input.oldEffective.calendarDates);
    const newAll = new Set(input.newEffective.calendarDates);
    const removed = [...oldAll].filter((d) => !newAll.has(d));
    const app = await hrModel.get(hrTables.leaveApplications, input.leaveApplicationId);
    if (!app)
        throw new Error("Leave application not found");
    let recalculated = 0;
    for (const date of removed) {
        await recalculateAttendanceForDate(input.propertyId, app.employeeId, date, {
            changedBy: input.changedBy,
            clearLeaveLink: true,
        });
        recalculated++;
    }
    for (const date of [...oldEligible].filter((d) => newAll.has(d) && !newEligible.has(d))) {
        await recalculateAttendanceForDate(input.propertyId, app.employeeId, date, {
            changedBy: input.changedBy,
            clearLeaveLink: true,
        });
        recalculated++;
    }
    const synced = await syncLeaveToAttendance(input.propertyId, input.leaveApplicationId, input.newEffective, input.changedBy);
    return { synced, recalculated };
}
export async function recalculateAllDatesInRange(propertyId, employeeId, fromDate, toDate, changedBy) {
    const dates = eachDateInclusive(fromDate, toDate);
    return recalculateDatesAfterLeaveChange(propertyId, employeeId, dates, changedBy);
}
/** @deprecated Use syncLeaveToAttendance from leave-attendance-sync.service */
export async function syncApprovedLeaveToAttendance(propertyId, leaveApplicationId, changedBy) {
    const { calculateEffectiveLeaveDates } = await import("../leave/leave-effective-days.service.js");
    const app = await hrModel.get(hrTables.leaveApplications, leaveApplicationId);
    if (!app)
        throw new Error("Leave application not found");
    const effective = await calculateEffectiveLeaveDates({
        propertyId,
        employeeId: app.employeeId,
        fromDate: app.fromDate,
        toDate: app.toDate,
        durationOption: app.durationOption,
    });
    return syncLeaveToAttendance(propertyId, leaveApplicationId, effective, changedBy);
}
//# sourceMappingURL=leave-attendance-sync.service.js.map
import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { calculateEffectiveLeaveDates } from "./leave-effective-days.service.js";
import { applyConsumption, applyDifferential, applyRestoration, writeLeaveAudit, } from "./leave-balance.service.js";
import { recalculateAllDatesInRange, syncLeaveApplicationDiff, syncLeaveToAttendance, } from "../attendance/leave-attendance-sync.service.js";
function snapshotFields(effective) {
    return {
        calendarDays: effective.calendarDays,
        effectiveDays: effective.effectiveDays,
        consumedDates: effective.eligibleDates,
        excludedDates: effective.excluded,
        totalDays: effective.effectiveDays,
    };
}
export async function previewLeaveDays(input) {
    return calculateEffectiveLeaveDates({
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        durationOption: input.durationOption,
    });
}
export async function approveLeave(input) {
    const app = await hrModel.get(hrTables.leaveApplications, input.leaveRequestId);
    if (!app || app.propertyId !== input.propertyId) {
        throw new Error("Leave application not found");
    }
    if (app.status === "Approved") {
        throw new Error("Leave application is already approved");
    }
    if (app.status === "Cancelled" || app.status === "Rejected") {
        throw new Error(`Cannot approve leave with status ${app.status}`);
    }
    const effective = await calculateEffectiveLeaveDates({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        fromDate: app.fromDate,
        toDate: app.toDate,
        durationOption: app.durationOption ?? undefined,
    });
    const balanceResult = await applyConsumption({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        leaveTypeId: app.leaveTypeId,
        leaveTypeCode: app.leaveTypeCode,
        leaveRequestId: app.id,
        effectiveDates: effective.eligibleDates,
        days: effective.effectiveDays,
        createdBy: input.approvedBy,
        remarks: `Approved leave ${app.id}. Effective days: ${effective.effectiveDays}.`,
    });
    const synced = await syncLeaveToAttendance(app.propertyId, app.id, effective, input.approvedBy);
    const row = await hrModel.update(hrTables.leaveApplications, app.id, {
        status: "Approved",
        approvedBy: input.approvedBy ?? "HR",
        ...snapshotFields(effective),
        lastBalanceTransactionId: balanceResult.transactionId,
        updatedAt: new Date().toISOString(),
    });
    await writeLeaveAudit({
        propertyId: app.propertyId,
        leaveRequestId: app.id,
        action: "Leave Approved",
        changedBy: input.approvedBy,
        auditNotes: `Effective leave days: ${effective.effectiveDays}. Calendar range: ${app.fromDate} to ${app.toDate}. Attendance records synced: ${synced}.`,
    });
    return { ...row, attendanceRecordsSynced: synced, effectiveDays: effective.effectiveDays };
}
export async function cancelLeave(input) {
    const app = await hrModel.get(hrTables.leaveApplications, input.leaveRequestId);
    if (!app || app.propertyId !== input.propertyId) {
        throw new Error("Leave application not found");
    }
    if (app.status !== "Approved") {
        throw new Error("Only approved leave can be cancelled");
    }
    const oldEffective = await calculateEffectiveLeaveDates({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        fromDate: app.fromDate,
        toDate: app.toDate,
        durationOption: app.durationOption ?? undefined,
    });
    if (input.newToDate) {
        return modifyLeave({
            propertyId: input.propertyId,
            leaveRequestId: input.leaveRequestId,
            fromDate: app.fromDate.slice(0, 10),
            toDate: input.newToDate.slice(0, 10),
            changedBy: input.changedBy,
        });
    }
    const consumedDays = Number(app.effectiveDays ?? oldEffective.effectiveDays);
    const consumedDates = app.consumedDates ?? oldEffective.eligibleDates;
    await applyRestoration({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        leaveTypeId: app.leaveTypeId,
        leaveTypeCode: app.leaveTypeCode,
        leaveRequestId: app.id,
        effectiveDates: consumedDates,
        days: consumedDays,
        createdBy: input.changedBy,
        remarks: `Leave ${app.id} cancelled. Restored ${consumedDays} day(s).`,
    });
    const recalculated = await recalculateAllDatesInRange(app.propertyId, app.employeeId, app.fromDate, app.toDate, input.changedBy);
    const row = await hrModel.update(hrTables.leaveApplications, app.id, {
        status: "Cancelled",
        effectiveDays: 0,
        consumedDates: [],
        updatedAt: new Date().toISOString(),
    });
    await writeLeaveAudit({
        propertyId: app.propertyId,
        leaveRequestId: app.id,
        action: "Leave Cancelled",
        changedBy: input.changedBy,
        auditNotes: `Restored ${consumedDays} effective day(s). Recalculated ${recalculated} attendance date(s).`,
    });
    return { ...row, attendanceRecalculated: recalculated, restoredDays: consumedDays };
}
export async function modifyLeave(input) {
    const app = await hrModel.get(hrTables.leaveApplications, input.leaveRequestId);
    if (!app || app.propertyId !== input.propertyId) {
        throw new Error("Leave application not found");
    }
    if (app.status !== "Approved") {
        throw new Error("Only approved leave can be modified");
    }
    const oldEffective = await calculateEffectiveLeaveDates({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        fromDate: app.fromDate,
        toDate: app.toDate,
        durationOption: app.durationOption ?? undefined,
    });
    const newEffective = await calculateEffectiveLeaveDates({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        durationOption: input.durationOption ?? app.durationOption ?? undefined,
    });
    const restoredDates = oldEffective.eligibleDates.filter((d) => !newEffective.eligibleDates.includes(d));
    const consumedDates = newEffective.eligibleDates.filter((d) => !oldEffective.eligibleDates.includes(d));
    await applyDifferential({
        propertyId: app.propertyId,
        employeeId: app.employeeId,
        leaveTypeId: app.leaveTypeId,
        leaveTypeCode: app.leaveTypeCode,
        leaveRequestId: app.id,
        oldEffectiveDays: oldEffective.effectiveDays,
        newEffectiveDays: newEffective.effectiveDays,
        restoredDates,
        consumedDates,
        createdBy: input.changedBy,
        remarks: `Leave modified. Effective days changed from ${oldEffective.effectiveDays} to ${newEffective.effectiveDays}.`,
    });
    const { synced, recalculated } = await syncLeaveApplicationDiff({
        propertyId: app.propertyId,
        leaveApplicationId: app.id,
        oldEffective,
        newEffective,
        changedBy: input.changedBy,
    });
    const row = await hrModel.update(hrTables.leaveApplications, app.id, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        durationOption: input.durationOption ?? app.durationOption,
        ...snapshotFields(newEffective),
        updatedAt: new Date().toISOString(),
    });
    await writeLeaveAudit({
        propertyId: app.propertyId,
        leaveRequestId: app.id,
        action: "Leave Modified",
        changedBy: input.changedBy,
        auditNotes: `Effective leave days changed from ${oldEffective.effectiveDays} to ${newEffective.effectiveDays}. Synced: ${synced}, recalculated: ${recalculated}.`,
    });
    return {
        ...row,
        oldEffectiveDays: oldEffective.effectiveDays,
        newEffectiveDays: newEffective.effectiveDays,
        attendanceSynced: synced,
        attendanceRecalculated: recalculated,
    };
}
export async function enrichLeaveApplicationOnCreate(input) {
    const effective = await calculateEffectiveLeaveDates(input);
    return {
        calendarDays: effective.calendarDays,
        totalDays: effective.calendarDays,
        effectiveDays: null,
        consumedDates: [],
        excludedDates: effective.excluded,
    };
}
//# sourceMappingURL=leave-lifecycle.service.js.map
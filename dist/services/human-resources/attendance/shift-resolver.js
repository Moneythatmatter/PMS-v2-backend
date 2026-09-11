import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { dateAtTime, scheduledHoursFromShift, } from "./time-calculator.js";
function toShiftTiming(row) {
    return {
        startTime: row.startTime ?? "09:00",
        endTime: row.endTime ?? "18:00",
        breakDurationMinutes: Number(row.breakDurationMinutes ?? 0),
        totalWorkingHours: Number(row.totalWorkingHours ?? 0),
        isNightShift: Boolean(row.isNightShift),
    };
}
function isEffectiveOnDate(effectiveFrom, effectiveTo, date) {
    const from = effectiveFrom.slice(0, 10);
    const to = effectiveTo?.slice(0, 10);
    if (date < from)
        return false;
    if (to && date > to)
        return false;
    return true;
}
export async function resolveShiftForEmployee(employeeId, attendanceDate) {
    const assignments = await hrModel.list(hrTables.shiftAssignments, {
        filters: { employee_id: employeeId, status: "Active" },
        orderBy: "effective_from",
        ascending: false,
    });
    const activeAssignment = assignments.find((a) => a.status !== "Expired" &&
        isEffectiveOnDate(a.effectiveFrom, a.effectiveTo, attendanceDate));
    if (activeAssignment?.shiftTypeId) {
        const shiftType = await hrModel.get(hrTables.shiftTypes, activeAssignment.shiftTypeId);
        if (shiftType && shiftType.status !== "Inactive") {
            return {
                shiftId: shiftType.id,
                timing: toShiftTiming({
                    startTime: activeAssignment.startTime ?? shiftType.startTime,
                    endTime: activeAssignment.endTime ?? shiftType.endTime,
                    breakDurationMinutes: shiftType.breakDurationMinutes,
                    totalWorkingHours: shiftType.totalWorkingHours,
                    isNightShift: shiftType.isNightShift,
                }),
                shiftCode: activeAssignment.shiftCode ?? shiftType.shiftCode,
                shiftName: activeAssignment.shiftName ?? shiftType.shiftName,
            };
        }
    }
    const employee = await hrModel.get(hrTables.employees, employeeId);
    if (employee?.shiftTypeId) {
        const shiftType = await hrModel.get(hrTables.shiftTypes, employee.shiftTypeId);
        if (shiftType) {
            return {
                shiftId: shiftType.id,
                timing: toShiftTiming(shiftType),
                shiftCode: shiftType.shiftCode,
                shiftName: shiftType.shiftName,
            };
        }
    }
    const defaults = await hrModel.list(hrTables.shiftTypes, {
        filters: { status: "Active" },
        orderBy: "shift_code",
        limit: 1,
    });
    if (defaults[0]) {
        return {
            shiftId: defaults[0].id,
            timing: toShiftTiming(defaults[0]),
            shiftCode: defaults[0].shiftCode,
            shiftName: defaults[0].shiftName,
        };
    }
    return {
        shiftId: "",
        timing: {
            startTime: "09:00",
            endTime: "18:00",
            breakDurationMinutes: 60,
            totalWorkingHours: 8,
            isNightShift: false,
        },
        shiftCode: "GEN",
        shiftName: "General Shift",
    };
}
export function scheduledHoursForShift(timing) {
    return scheduledHoursFromShift(timing);
}
export function defaultPunchInForShift(attendanceDate, timing) {
    return dateAtTime(attendanceDate, timing.startTime) ?? new Date();
}
//# sourceMappingURL=shift-resolver.js.map
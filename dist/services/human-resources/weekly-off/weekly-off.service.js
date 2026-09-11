import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { dayNameForDate } from "../attendance/time-calculator.js";
const OPEN_ENDED = "9999-12-31";
const DISABLED_STATUSES = new Set(["cancelled", "disabled", "inactive"]);
export function isExplicitlyDisabled(status) {
    if (!status)
        return false;
    return DISABLED_STATUSES.has(status.trim().toLowerCase());
}
/** Target-date applicability — NOT display status. */
export function isEffectiveOnDate(effectiveFrom, effectiveTo, targetDate) {
    const from = effectiveFrom.slice(0, 10);
    const to = effectiveTo?.slice(0, 10);
    const date = targetDate.slice(0, 10);
    if (date < from)
        return false;
    if (to && date > to)
        return false;
    return true;
}
/** UI-only: derive Upcoming / Active / Expired from today's date. */
export function deriveDisplayStatus(effectiveFrom, effectiveTo, today) {
    const from = effectiveFrom.slice(0, 10);
    const to = effectiveTo?.slice(0, 10);
    const t = today.slice(0, 10);
    if (t < from)
        return "Upcoming";
    if (to && t > to)
        return "Expired";
    return "Active";
}
export function rangesOverlap(fromA, toA, fromB, toB) {
    const aFrom = fromA.slice(0, 10);
    const aTo = (toA?.slice(0, 10) ?? OPEN_ENDED);
    const bFrom = fromB.slice(0, 10);
    const bTo = (toB?.slice(0, 10) ?? OPEN_ENDED);
    return aFrom <= bTo && bFrom <= aTo;
}
export function assignmentIncludesDay(assignment, day) {
    const dayLower = day.toLowerCase();
    const days = Array.isArray(assignment.days) ? assignment.days : [];
    if (assignment.offType === "Rotational" && assignment.rotationPattern) {
        return assignment.rotationPattern.toLowerCase().includes(dayLower);
    }
    return days.some((d) => d.toLowerCase() === dayLower);
}
export function assignmentMatchesWeekday(assignment, targetDate) {
    const dayName = dayNameForDate(targetDate);
    return assignmentIncludesDay(assignment, dayName);
}
export function daysOverlap(a, b) {
    const setB = new Set(b.map((d) => d.toLowerCase()));
    return a.some((d) => setB.has(d.toLowerCase()));
}
/** Pure resolver — authority for target-date weekly off. */
export function resolveWeeklyOffFromAssignments(assignments, targetDate) {
    for (const assignment of assignments) {
        if (isExplicitlyDisabled(assignment.status))
            continue;
        if (!isEffectiveOnDate(assignment.effectiveFrom, assignment.effectiveTo, targetDate))
            continue;
        if (!assignmentMatchesWeekday(assignment, targetDate))
            continue;
        return {
            isWeeklyOff: true,
            assignmentId: assignment.id,
            day: dayNameForDate(targetDate),
            offType: assignment.offType ?? "Fixed",
        };
    }
    return { isWeeklyOff: false };
}
export async function resolveWeeklyOffForDate(input) {
    const assignments = await hrModel.list(hrTables.weeklyOffs, {
        filters: { property_id: input.propertyId, employee_id: input.employeeId },
    });
    return resolveWeeklyOffFromAssignments(assignments, input.date);
}
export async function findEmployeeConflicts(input) {
    const assignments = await hrModel.list(hrTables.weeklyOffs, {
        filters: { property_id: input.propertyId, employee_id: input.employeeId },
    });
    const conflicts = [];
    for (const a of assignments) {
        if (input.excludeId && a.id === input.excludeId)
            continue;
        if (isExplicitlyDisabled(a.status))
            continue;
        if (!rangesOverlap(a.effectiveFrom, a.effectiveTo, input.effectiveFrom, input.effectiveTo))
            continue;
        const existingDays = Array.isArray(a.days) ? a.days : [];
        if (!daysOverlap(existingDays, input.days))
            continue;
        conflicts.push({
            assignmentId: a.id,
            days: existingDays,
            effectiveFrom: a.effectiveFrom.slice(0, 10),
            effectiveTo: a.effectiveTo?.slice(0, 10) ?? null,
        });
    }
    return conflicts;
}
export async function findStaffingPreview(input) {
    const assignments = await hrModel.list(hrTables.weeklyOffs, {
        filters: { property_id: input.propertyId },
    });
    const employees = await hrModel.list(hrTables.employees, {
        filters: { property_id: input.propertyId },
    });
    const empLookup = new Map(employees.map((e) => [e.id, e]));
    const matching = assignments.filter((a) => {
        if (input.excludeEmployeeId && a.employeeId === input.excludeEmployeeId)
            return false;
        if (isExplicitlyDisabled(a.status))
            return false;
        if (!assignmentIncludesDay(a, input.day))
            return false;
        if (!rangesOverlap(a.effectiveFrom, a.effectiveTo, input.effectiveFrom, input.effectiveTo)) {
            return false;
        }
        return true;
    });
    const departmentCounts = {};
    const previewEmployees = [];
    for (const a of matching) {
        const emp = empLookup.get(a.employeeId);
        const dept = emp?.department ?? "Unknown";
        if (input.department && input.department !== "ALL" && dept !== input.department)
            continue;
        departmentCounts[dept] = (departmentCounts[dept] ?? 0) + 1;
        previewEmployees.push({
            employeeId: a.employeeId,
            employeeName: emp?.name ?? a.employeeId,
            department: dept,
            designation: emp?.designation ?? "",
            assignmentId: a.id,
            effectiveFrom: a.effectiveFrom.slice(0, 10),
            effectiveTo: a.effectiveTo?.slice(0, 10) ?? null,
        });
    }
    previewEmployees.sort((x, y) => x.employeeName.localeCompare(y.employeeName));
    return {
        day: input.day,
        effectiveFrom: input.effectiveFrom.slice(0, 10),
        effectiveTo: input.effectiveTo.slice(0, 10),
        total: previewEmployees.length,
        departmentCounts,
        employees: previewEmployees,
    };
}
export function formatConflictMessage(conflicts, employeeName) {
    const c = conflicts[0];
    if (!c)
        return "Conflicting weekly off schedule exists.";
    const days = c.days.join(", ");
    const to = c.effectiveTo ?? "open-ended";
    const who = employeeName ? `${employeeName} already has` : "This employee already has";
    return `${who} ${days} weekly off from ${c.effectiveFrom} to ${to}. Close or update that schedule first.`;
}
//# sourceMappingURL=weekly-off.service.js.map
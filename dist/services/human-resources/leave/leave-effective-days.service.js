import { classifyDay } from "../attendance/calendar-resolver.js";
import { eachDateInclusive } from "../attendance/time-calculator.js";
function dayWeight(durationOption, fromDate, toDate) {
    const opt = (durationOption ?? "Full Day").toLowerCase();
    if (opt.includes("half") && fromDate && toDate && fromDate.slice(0, 10) === toDate.slice(0, 10)) {
        return 0.5;
    }
    return 1;
}
/** Pure builder for tests — classifications must be pre-fetched per date. */
export function buildEffectiveLeaveFromClassifications(calendarDates, classifications, durationOption, fromDate, toDate) {
    const weight = dayWeight(durationOption, fromDate, toDate);
    const eligibleDates = [];
    const excluded = [];
    const perDate = [];
    for (const date of calendarDates) {
        const c = classifications.get(date) ?? { dayType: "WORKING_DAY", holidayId: null };
        const consumesLeave = c.dayType === "WORKING_DAY";
        perDate.push({
            date,
            dayType: c.dayType,
            consumesLeave,
            holidayId: c.holidayId ?? null,
        });
        if (consumesLeave) {
            eligibleDates.push(date);
        }
        else if (c.dayType === "HOLIDAY") {
            excluded.push({ date, reason: "HOLIDAY", holidayId: c.holidayId ?? null });
        }
        else {
            excluded.push({ date, reason: "WEEKLY_OFF" });
        }
    }
    const effectiveDays = weight < 1 && eligibleDates.length === 1
        ? weight
        : eligibleDates.length * (calendarDates.length === 1 && weight < 1 ? weight : 1);
    return {
        calendarDates,
        calendarDays: calendarDates.length * (calendarDates.length === 1 && weight < 1 ? weight : 1),
        eligibleDates,
        excluded,
        effectiveDays: Math.round(effectiveDays * 10) / 10,
        perDate,
    };
}
/** Backend authority for eligible leave dates (excludes holidays & weekly offs by default). */
export async function calculateEffectiveLeaveDates(input) {
    const from = input.fromDate.slice(0, 10);
    const to = input.toDate.slice(0, 10);
    const calendarDates = eachDateInclusive(from, to);
    const classifications = new Map();
    for (const date of calendarDates) {
        const c = await classifyDay(input.propertyId, input.employeeId, date);
        classifications.set(date, { dayType: c.dayType, holidayId: c.holidayId });
    }
    return buildEffectiveLeaveFromClassifications(calendarDates, classifications, input.durationOption, from, to);
}
//# sourceMappingURL=leave-effective-days.service.js.map
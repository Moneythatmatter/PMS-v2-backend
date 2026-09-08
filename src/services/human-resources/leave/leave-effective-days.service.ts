import { classifyDay } from "../attendance/calendar-resolver.js";
import { eachDateInclusive } from "../attendance/time-calculator.js";

export type ExcludedDate = {
  date: string;
  reason: "HOLIDAY" | "WEEKLY_OFF";
  holidayId?: string | null;
};

export type PerDateLeaveBreakdown = {
  date: string;
  dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF";
  consumesLeave: boolean;
  holidayId?: string | null;
};

export type EffectiveLeaveResult = {
  calendarDates: string[];
  calendarDays: number;
  eligibleDates: string[];
  excluded: ExcludedDate[];
  effectiveDays: number;
  perDate: PerDateLeaveBreakdown[];
};

export type EffectiveLeaveInput = {
  propertyId: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  durationOption?: string;
};

function dayWeight(durationOption?: string, fromDate?: string, toDate?: string): number {
  const opt = (durationOption ?? "Full Day").toLowerCase();
  if (opt.includes("half") && fromDate && toDate && fromDate.slice(0, 10) === toDate.slice(0, 10)) {
    return 0.5;
  }
  return 1;
}

/** Pure builder for tests — classifications must be pre-fetched per date. */
export function buildEffectiveLeaveFromClassifications(
  calendarDates: string[],
  classifications: Map<
    string,
    { dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF"; holidayId?: string | null }
  >,
  durationOption?: string,
  fromDate?: string,
  toDate?: string,
): EffectiveLeaveResult {
  const weight = dayWeight(durationOption, fromDate, toDate);
  const eligibleDates: string[] = [];
  const excluded: ExcludedDate[] = [];
  const perDate: PerDateLeaveBreakdown[] = [];

  for (const date of calendarDates) {
    const c = classifications.get(date) ?? { dayType: "WORKING_DAY" as const, holidayId: null };
    const consumesLeave = c.dayType === "WORKING_DAY";
    perDate.push({
      date,
      dayType: c.dayType,
      consumesLeave,
      holidayId: c.holidayId ?? null,
    });
    if (consumesLeave) {
      eligibleDates.push(date);
    } else if (c.dayType === "HOLIDAY") {
      excluded.push({ date, reason: "HOLIDAY", holidayId: c.holidayId ?? null });
    } else {
      excluded.push({ date, reason: "WEEKLY_OFF" });
    }
  }

  const effectiveDays =
    weight < 1 && eligibleDates.length === 1
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
export async function calculateEffectiveLeaveDates(
  input: EffectiveLeaveInput,
): Promise<EffectiveLeaveResult> {
  const from = input.fromDate.slice(0, 10);
  const to = input.toDate.slice(0, 10);
  const calendarDates = eachDateInclusive(from, to);

  const classifications = new Map<
    string,
    { dayType: "WORKING_DAY" | "HOLIDAY" | "WEEKLY_OFF"; holidayId?: string | null }
  >();

  for (const date of calendarDates) {
    const c = await classifyDay(input.propertyId, input.employeeId, date);
    classifications.set(date, { dayType: c.dayType, holidayId: c.holidayId });
  }

  return buildEffectiveLeaveFromClassifications(
    calendarDates,
    classifications,
    input.durationOption,
    from,
    to,
  );
}

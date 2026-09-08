/** Parse HH:MM or HH:MM AM/PM to minutes from midnight. */
export function parseTimeToMinutes(time: string): number | null {
  const trimmed = time.trim();
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridiem = match12[3].toUpperCase();
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return null;
}

export type ShiftTiming = {
  startTime: string;
  endTime: string;
  breakDurationMinutes: number;
  totalWorkingHours: number;
  isNightShift: boolean;
};

/** Build a Date on attendanceDate at the given clock time (local server TZ). */
export function dateAtTime(attendanceDate: string, time: string): Date | null {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null) return null;
  const [y, m, d] = attendanceDate.split("-").map(Number);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(y, m - 1, d, hours, mins, 0, 0);
}

/** Shift end instant; rolls to next calendar day for overnight shifts. */
export function shiftEndDateTime(
  attendanceDate: string,
  shift: ShiftTiming,
): Date | null {
  const start = dateAtTime(attendanceDate, shift.startTime);
  const end = dateAtTime(attendanceDate, shift.endTime);
  if (!start || !end) return null;
  if (shift.isNightShift || end <= start) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

/** Gross punch duration in hours (handles overnight punch-out). */
export function grossPunchHours(punchIn: Date, punchOut: Date): number {
  const diffMs = punchOut.getTime() - punchIn.getTime();
  if (diffMs <= 0) return 0;
  return Math.round((diffMs / 3_600_000) * 100) / 100;
}

/** Net worked hours after break deduction from shift master. */
export function calculateWorkedHours(
  punchIn: Date,
  punchOut: Date,
  breakDurationMinutes: number,
): number {
  const gross = grossPunchHours(punchIn, punchOut);
  const breakHours = breakDurationMinutes / 60;
  const net = Math.max(0, gross - breakHours);
  return Math.round(net * 100) / 100;
}

export function calculateExtraHours(
  workedHours: number,
  scheduledHours: number,
): number {
  const extra = Math.max(0, workedHours - scheduledHours);
  return Math.round(extra * 100) / 100;
}

export function scheduledHoursFromShift(shift: ShiftTiming): number {
  if (shift.totalWorkingHours > 0) return shift.totalWorkingHours;
  const start = parseTimeToMinutes(shift.startTime);
  const end = parseTimeToMinutes(shift.endTime);
  if (start == null || end == null) return 0;
  let span = end - start;
  if (span <= 0) span += 24 * 60;
  const gross = span / 60;
  const net = Math.max(0, gross - shift.breakDurationMinutes / 60);
  return Math.round(net * 100) / 100;
}

export function isShiftCutoffPassed(
  attendanceDate: string,
  shift: ShiftTiming,
  now: Date = new Date(),
): boolean {
  const end = shiftEndDateTime(attendanceDate, shift);
  if (!end) return false;
  return now.getTime() >= end.getTime();
}

export function isoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function eachDateInclusive(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    dates.push(isoDateOnly(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function dayNameForDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

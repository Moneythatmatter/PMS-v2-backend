type EmployeeLike = {
  id: string;
  firstName?: string;
  lastName?: string;
  dob?: string | null;
  joinDate?: string | null;
  avatar?: string | null;
  department?: string | null;
  departmentId?: string | null;
  status?: string;
};

type HolidayLike = {
  id: string;
  holidayName: string;
  holidayDate: string;
  dayOfWeek?: string | null;
  category?: string | null;
  status?: string | null;
};

export type UpcomingBirthdayEvent = {
  id: string;
  employeeId: string;
  name: string;
  avatar: string;
  department: string;
  type: "birthday";
  eventDate: string;
  displayDate: string;
  daysUntil: number;
};

export type UpcomingAnniversaryEvent = {
  id: string;
  employeeId: string;
  name: string;
  avatar: string;
  department: string;
  type: "anniversary";
  eventDate: string;
  displayDate: string;
  daysUntil: number;
  years: number;
};

export type UpcomingHolidayEvent = {
  id: string;
  title: string;
  eventDate: string;
  displayDate: string;
  dayOfWeek: string;
  category: string;
  daysUntil: number;
  type: "holiday";
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDisplayDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function nextAnnualOccurrence(source: Date, from: Date): Date {
  const fromStart = startOfDay(from);
  let candidate = new Date(fromStart.getFullYear(), source.getMonth(), source.getDate());
  if (candidate < fromStart) {
    candidate = new Date(fromStart.getFullYear() + 1, source.getMonth(), source.getDate());
  }
  return candidate;
}

function employeeName(emp: EmployeeLike): string {
  return `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || "Employee";
}

function employeeAvatar(emp: EmployeeLike): string {
  const avatar = String(emp.avatar ?? "").trim();
  if (avatar) return avatar.slice(0, 2).toUpperCase();
  const name = employeeName(emp);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "??";
}

export function buildUpcomingBirthdays(
  employees: EmployeeLike[],
  options?: { fromDate?: Date; daysAhead?: number; departmentLookup?: Map<string, string> },
): UpcomingBirthdayEvent[] {
  const from = startOfDay(options?.fromDate ?? new Date());
  const daysAhead = options?.daysAhead ?? 60;
  const deptLookup = options?.departmentLookup ?? new Map<string, string>();
  const events: UpcomingBirthdayEvent[] = [];

  for (const emp of employees) {
    if (emp.status && emp.status !== "Active") continue;
    const dob = parseIsoDate(emp.dob ?? undefined);
    if (!dob) continue;

    const next = nextAnnualOccurrence(dob, from);
    const until = daysBetween(from, next);
    if (until > daysAhead) continue;

    const iso = toIso(next);
    const department =
      emp.department ??
      (emp.departmentId ? deptLookup.get(emp.departmentId) : undefined) ??
      "—";

    events.push({
      id: `birthday-${emp.id}-${iso}`,
      employeeId: emp.id,
      name: employeeName(emp),
      avatar: employeeAvatar(emp),
      department,
      type: "birthday",
      eventDate: iso,
      displayDate: formatDisplayDate(iso),
      daysUntil: until,
    });
  }

  return events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

export function buildUpcomingAnniversaries(
  employees: EmployeeLike[],
  options?: { fromDate?: Date; daysAhead?: number; departmentLookup?: Map<string, string> },
): UpcomingAnniversaryEvent[] {
  const from = startOfDay(options?.fromDate ?? new Date());
  const daysAhead = options?.daysAhead ?? 60;
  const deptLookup = options?.departmentLookup ?? new Map<string, string>();
  const events: UpcomingAnniversaryEvent[] = [];

  for (const emp of employees) {
    if (emp.status && emp.status !== "Active") continue;
    const joinDate = parseIsoDate(emp.joinDate ?? undefined);
    if (!joinDate) continue;

    const next = nextAnnualOccurrence(joinDate, from);
    const years = next.getFullYear() - joinDate.getFullYear();
    if (years < 1) continue;

    const until = daysBetween(from, next);
    if (until > daysAhead) continue;

    const iso = toIso(next);
    const department =
      emp.department ??
      (emp.departmentId ? deptLookup.get(emp.departmentId) : undefined) ??
      "—";

    events.push({
      id: `anniversary-${emp.id}-${iso}`,
      employeeId: emp.id,
      name: employeeName(emp),
      avatar: employeeAvatar(emp),
      department,
      type: "anniversary",
      eventDate: iso,
      displayDate: formatDisplayDate(iso),
      daysUntil: until,
      years,
    });
  }

  return events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

export function buildUpcomingHolidays(
  holidays: HolidayLike[],
  options?: { fromDate?: Date; daysAhead?: number },
): UpcomingHolidayEvent[] {
  const from = startOfDay(options?.fromDate ?? new Date());
  const fromIso = toIso(from);
  const daysAhead = options?.daysAhead ?? 120;
  const events: UpcomingHolidayEvent[] = [];

  for (const holiday of holidays) {
    if (holiday.status && holiday.status !== "Active") continue;
    const iso = String(holiday.holidayDate ?? "").slice(0, 10);
    if (!iso || iso < fromIso) continue;

    const until = daysBetween(from, parseIsoDate(iso) ?? from);
    if (until > daysAhead) continue;

    events.push({
      id: holiday.id,
      title: holiday.holidayName,
      eventDate: iso,
      displayDate: formatDisplayDate(iso),
      dayOfWeek: String(holiday.dayOfWeek ?? ""),
      category: String(holiday.category ?? "Holiday"),
      daysUntil: until,
      type: "holiday",
    });
  }

  return events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

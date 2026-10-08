/** Reservation dates and times are entered in the hotel's local time, not the server's. */
export const PROPERTY_TZ = process.env.PROPERTY_TZ || "Asia/Kolkata";
function zoneParts(date, timeZone = PROPERTY_TZ) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}
/** Minutes the zone is ahead of UTC at this instant. */
function zoneOffsetMinutes(date, timeZone = PROPERTY_TZ) {
    const p = zoneParts(date, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}
export function isIsoDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/** "19:30", "7:30 PM" → "19:30"; null when it can't be read. */
export function normalizeTime(value) {
    const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (!m)
        return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    const suffix = m[3]?.toLowerCase();
    if (suffix) {
        if (h < 1 || h > 12)
            return null;
        if (suffix === "pm" && h < 12)
            h += 12;
        if (suffix === "am" && h === 12)
            h = 0;
    }
    if (h > 23 || min > 59)
        return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
/** Local date + HH:MM in the property zone → UTC instant. */
export function zonedDateTimeToUtc(date, time, timeZone = PROPERTY_TZ) {
    const [y, mo, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
    // Re-check once so dates on either side of a DST change land correctly.
    return new Date(guess - zoneOffsetMinutes(new Date(first), timeZone) * 60_000);
}
/** Today's date in the property zone, YYYY-MM-DD. */
export function propertyToday(now = new Date(), timeZone = PROPERTY_TZ) {
    const p = zoneParts(now, timeZone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function formatPropertyTime(date, timeZone = PROPERTY_TZ) {
    return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}
//# sourceMappingURL=property-time.js.map
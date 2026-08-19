/** Shared date/time formatting for the whole API. */
const timeOpts = {
    hour: "2-digit",
    minute: "2-digit",
};
const dateOpts = {
    day: "2-digit",
    month: "short",
    year: "numeric",
};
const stampOpts = {
    dateStyle: "medium",
    timeStyle: "short",
};
export function formatTime(date = new Date()) {
    return date.toLocaleTimeString("en-IN", timeOpts);
}
export function formatDate(date = new Date()) {
    return date.toLocaleDateString("en-IN", dateOpts);
}
export function timestamp(date = new Date()) {
    return date.toLocaleString("en-IN", stampOpts);
}
export function todayIso(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
export function isArrivingTodayReservation(booking, now = new Date()) {
    if (booking.arrivingToday)
        return true;
    const checkIn = String(booking.checkIn ?? "").trim();
    if (!checkIn)
        return false;
    const today = todayIso(now);
    const displayToday = now.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
    return (checkIn === today ||
        checkIn.startsWith(today) ||
        checkIn.includes(displayToday));
}
/** @deprecated Prefer formatTime / formatDate / timestamp */
export const nowTime = formatTime;
export const nowDate = formatDate;
export const nowStamp = timestamp;
//# sourceMappingURL=date.js.map
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
/** @deprecated Prefer formatTime / formatDate / timestamp */
export const nowTime = formatTime;
export const nowDate = formatDate;
export const nowStamp = timestamp;
//# sourceMappingURL=date.js.map
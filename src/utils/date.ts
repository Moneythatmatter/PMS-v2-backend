/** Shared date/time formatting for the whole API. */

const timeOpts: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

const dateOpts: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const stampOpts: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString("en-IN", timeOpts);
}

export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString("en-IN", dateOpts);
}

export function timestamp(date: Date = new Date()): string {
  return date.toLocaleString("en-IN", stampOpts);
}

/** @deprecated Prefer formatTime / formatDate / timestamp */
export const nowTime = formatTime;
export const nowDate = formatDate;
export const nowStamp = timestamp;

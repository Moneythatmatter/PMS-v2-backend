export const HK_ROOM_STATUSES = [
    "CLEAN",
    "DIRTY",
    "INSPECTING",
    "INSPECTED",
    "OUT_OF_SERVICE",
];
export function isHkRoomStatus(value) {
    return HK_ROOM_STATUSES.includes(value);
}
/** Map legacy UI labels to DB enum. */
export function normalizeHkRoomStatus(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (isHkRoomStatus(raw))
        return raw;
    if (/OUT.?OF.?SERVICE|OOO|OOS|BLOCKED/.test(raw))
        return "OUT_OF_SERVICE";
    if (/INSPECTING|CLEANING|INSPECTION/.test(raw))
        return "INSPECTING";
    if (/INSPECTED|READY/.test(raw))
        return "INSPECTED";
    if (/^CLEAN$/.test(raw))
        return "CLEAN";
    if (/DIRTY/.test(raw))
        return "DIRTY";
    return "DIRTY";
}
export const HK_TASK_TYPES = [
    "CHECKOUT_CLEANING",
    "REGULAR_CLEANING",
    "DEEP_CLEANING",
    "INSPECTION",
    "TURNDOWN",
    "SPECIAL_REQUEST",
];
export const HK_TASK_STATUSES = [
    "PENDING",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "APPROVED",
    "CANCELLED",
];
export const HK_TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export function isHkTaskType(value) {
    return HK_TASK_TYPES.includes(value);
}
export function isHkTaskStatus(value) {
    return HK_TASK_STATUSES.includes(value);
}
export function normalizeHkTaskType(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isHkTaskType(raw))
        return raw;
    if (/CHECKOUT|DEPARTURE/.test(raw))
        return "CHECKOUT_CLEANING";
    if (/DEEP/.test(raw))
        return "DEEP_CLEANING";
    if (/INSPECT/.test(raw))
        return "INSPECTION";
    if (/TURN/.test(raw))
        return "TURNDOWN";
    if (/SPECIAL/.test(raw))
        return "SPECIAL_REQUEST";
    return "REGULAR_CLEANING";
}
export function normalizeHkTaskStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isHkTaskStatus(raw))
        return raw;
    if (/PROGRESS|STARTED|CLEANING/.test(raw))
        return "IN_PROGRESS";
    if (/COMPLETE|DONE|FINISH/.test(raw))
        return "COMPLETED";
    if (/APPROVE|PASS/.test(raw))
        return "APPROVED";
    if (/CANCEL/.test(raw))
        return "CANCELLED";
    if (/ASSIGN/.test(raw))
        return "ASSIGNED";
    return "PENDING";
}
export function normalizeHkTaskPriority(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (HK_TASK_PRIORITIES.includes(raw)) {
        return raw;
    }
    return "MEDIUM";
}
export const PUBLIC_AREA_PRIORITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "URGENT",
];
export function normalizePublicAreaPriority(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (PUBLIC_AREA_PRIORITIES.includes(raw)) {
        return raw;
    }
    if (/LOW/.test(raw))
        return "LOW";
    if (/HIGH/.test(raw))
        return "HIGH";
    if (/URGENT|CRITICAL/.test(raw))
        return "URGENT";
    return "MEDIUM";
}
export const GUEST_REQUEST_TYPES = [
    "AMENITY",
    "LINEN",
    "TOWELS",
    "CLEANING",
    "LAUNDRY",
    "MINIBAR",
    "MAINTENANCE",
    "ROOM_SERVICE",
    "OTHER",
];
export const GUEST_REQUEST_STATUSES = [
    "PENDING",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
];
export const GUEST_REQUEST_PRIORITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "URGENT",
];
export function isGuestRequestType(value) {
    return GUEST_REQUEST_TYPES.includes(value);
}
export function isGuestRequestStatus(value) {
    return GUEST_REQUEST_STATUSES.includes(value);
}
export function normalizeGuestRequestType(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isGuestRequestType(raw))
        return raw;
    if (/TOWEL/.test(raw))
        return "TOWELS";
    if (/LINEN|PILLOW|BLANKET|COT/.test(raw))
        return "LINEN";
    if (/CLEAN/.test(raw))
        return "CLEANING";
    if (/LAUNDRY/.test(raw))
        return "LAUNDRY";
    if (/MINIBAR|MINI_BAR/.test(raw))
        return "MINIBAR";
    if (/AMEN|TOILETR|WATER|COFFEE|TEA|IRON|DRYER/.test(raw))
        return "AMENITY";
    if (/MAINT|REPAIR/.test(raw))
        return "MAINTENANCE";
    if (/ROOM.?SERVICE|FOOD/.test(raw))
        return "ROOM_SERVICE";
    return "OTHER";
}
export function normalizeGuestRequestStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isGuestRequestStatus(raw))
        return raw;
    if (/COMPLETE|DONE|CLOSED/.test(raw))
        return "COMPLETED";
    if (/PROGRESS|STARTED/.test(raw))
        return "IN_PROGRESS";
    if (/ASSIGN/.test(raw))
        return "ASSIGNED";
    if (/CANCEL/.test(raw))
        return "CANCELLED";
    if (/OPEN|PENDING|NEW/.test(raw))
        return "PENDING";
    return "PENDING";
}
export function normalizeGuestRequestPriority(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (GUEST_REQUEST_PRIORITIES.includes(raw)) {
        return raw;
    }
    if (/LOW/.test(raw))
        return "LOW";
    if (/HIGH/.test(raw))
        return "HIGH";
    if (/URGENT|CRITICAL/.test(raw))
        return "URGENT";
    return "MEDIUM";
}
export const MAINTENANCE_ISSUE_TYPES = [
    "ELECTRICAL",
    "PLUMBING",
    "HVAC",
    "CARPENTRY",
    "CIVIL",
    "APPLIANCE",
    "IT",
    "OTHER",
];
export const MAINTENANCE_REQUEST_STATUSES = [
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "AWAITING_VERIFICATION",
    "CLOSED",
    "CANCELLED",
];
export const MAINTENANCE_REQUEST_PRIORITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
];
export function isMaintenanceIssueType(value) {
    return MAINTENANCE_ISSUE_TYPES.includes(value);
}
export function isMaintenanceRequestStatus(value) {
    return MAINTENANCE_REQUEST_STATUSES.includes(value);
}
export function normalizeMaintenanceIssueType(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isMaintenanceIssueType(raw))
        return raw;
    if (/ELECT/.test(raw))
        return "ELECTRICAL";
    if (/PLUMB|LEAK|WATER/.test(raw))
        return "PLUMBING";
    if (/HVAC|AIR.?COND|AC\b|COOL/.test(raw))
        return "HVAC";
    if (/CARPENT|FURN/.test(raw))
        return "CARPENTRY";
    if (/CIVIL|PAINT|DOOR|WINDOW/.test(raw))
        return "CIVIL";
    if (/APPLIAN/.test(raw))
        return "APPLIANCE";
    if (/IT|TV|TELEVISION|NETWORK|WIFI/.test(raw))
        return "IT";
    return "OTHER";
}
export function normalizeMaintenanceRequestStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isMaintenanceRequestStatus(raw))
        return raw;
    if (/CLOSED|DONE/.test(raw))
        return "CLOSED";
    if (/AWAIT|VERIFY/.test(raw))
        return "AWAITING_VERIFICATION";
    if (/PROGRESS|STARTED/.test(raw))
        return "IN_PROGRESS";
    if (/ASSIGN/.test(raw))
        return "ASSIGNED";
    if (/CANCEL/.test(raw))
        return "CANCELLED";
    if (/OPEN|NEW|PENDING/.test(raw))
        return "OPEN";
    return "OPEN";
}
export function normalizeMaintenanceRequestPriority(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (MAINTENANCE_REQUEST_PRIORITIES.includes(raw)) {
        return raw;
    }
    if (/LOW/.test(raw))
        return "LOW";
    if (/CRITICAL/.test(raw))
        return "CRITICAL";
    if (/HIGH/.test(raw))
        return "HIGH";
    return "MEDIUM";
}
//# sourceMappingURL=housekeeping.js.map
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
    "GUEST_REQUEST",
    "TURNDOWN",
    "INSPECTION",
    "OTHER",
];
export const HK_TASK_STATUSES = [
    "PENDING",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "PENDING_INSPECTION",
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
    if (/GUEST|SPECIAL/.test(raw))
        return "GUEST_REQUEST";
    if (/OTHER/.test(raw))
        return "OTHER";
    return "REGULAR_CLEANING";
}
export function normalizeHkTaskStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isHkTaskStatus(raw))
        return raw;
    if (/PENDING.?INSPECT|AWAITING.?INSPECT/.test(raw))
        return "PENDING_INSPECTION";
    if (/PROGRESS|STARTED|CLEANING/.test(raw))
        return "IN_PROGRESS";
    if (/COMPLETE|DONE|FINISH/.test(raw))
        return "PENDING_INSPECTION";
    if (/APPROVE|PASS/.test(raw))
        return "APPROVED";
    if (/CANCEL/.test(raw))
        return "CANCELLED";
    if (/ASSIGN/.test(raw))
        return "ASSIGNED";
    return "PENDING";
}
export const HK_TASK_OVERDUE_EXCLUDED_STATUSES = new Set([
    "COMPLETED",
    "APPROVED",
    "CANCELLED",
]);
export function computeHkTaskOverdue(task) {
    if (!task.dueAt)
        return false;
    if (HK_TASK_OVERDUE_EXCLUDED_STATUSES.has(task.status))
        return false;
    return new Date(task.dueAt).getTime() < Date.now();
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
export const LOST_FOUND_CATEGORIES = [
    "ELECTRONICS",
    "JEWELRY",
    "CLOTHING",
    "DOCUMENTS",
    "CASH",
    "BAGS",
    "ACCESSORIES",
    "MEDICINE",
    "KEYS",
    "PERSONAL_ITEMS",
    "OTHER",
];
export const LOST_FOUND_STATUSES = [
    "STORED",
    "AWAITING_CLAIM",
    "UNDER_VERIFICATION",
    "CLAIMED",
    "RETURNED",
    "DISPOSED",
    "COURIER_DISPATCHED",
];
export const LOST_FOUND_RETURN_METHODS = [
    "IN_PERSON",
    "COURIER",
    "AUTHORIZED_PICKUP",
    "MAILED",
    "OTHER",
];
export function isLostFoundCategory(value) {
    return LOST_FOUND_CATEGORIES.includes(value);
}
export function isLostFoundStatus(value) {
    return LOST_FOUND_STATUSES.includes(value);
}
export function normalizeLostFoundCategory(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isLostFoundCategory(raw))
        return raw;
    if (/ELECT|PHONE|LAPTOP|TV/.test(raw))
        return "ELECTRONICS";
    if (/JEWEL|RING|GOLD/.test(raw))
        return "JEWELRY";
    if (/CLOTH|GARMENT|SHOE/.test(raw))
        return "CLOTHING";
    if (/DOC|PASSPORT|ID/.test(raw))
        return "DOCUMENTS";
    if (/CASH|MONEY|WALLET/.test(raw))
        return "CASH";
    if (/BAG|SUITCASE|LUGGAGE/.test(raw))
        return "BAGS";
    if (/ACCESS|WATCH|GLASS/.test(raw))
        return "ACCESSORIES";
    if (/MEDIC|DRUG|PILL/.test(raw))
        return "MEDICINE";
    if (/KEY/.test(raw))
        return "KEYS";
    if (/PERSONAL/.test(raw))
        return "PERSONAL_ITEMS";
    return "OTHER";
}
export function normalizeLostFoundStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (isLostFoundStatus(raw))
        return raw;
    if (/RETURN/.test(raw))
        return "RETURNED";
    if (/CLAIM/.test(raw))
        return "CLAIMED";
    if (/COURIER|DISPATCH/.test(raw))
        return "COURIER_DISPATCHED";
    if (/DISPOS/.test(raw))
        return "DISPOSED";
    if (/VERIF/.test(raw))
        return "UNDER_VERIFICATION";
    if (/AWAIT/.test(raw))
        return "AWAITING_CLAIM";
    if (/STORE/.test(raw))
        return "STORED";
    return "STORED";
}
export function normalizeLostFoundReturnMethod(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (!raw)
        return null;
    if (LOST_FOUND_RETURN_METHODS.includes(raw)) {
        return raw;
    }
    if (/COURIER|SHIP|DISPATCH/.test(raw))
        return "COURIER";
    if (/MAIL|POST/.test(raw))
        return "MAILED";
    if (/AUTH|PICKUP/.test(raw))
        return "AUTHORIZED_PICKUP";
    if (/PERSON|HAND/.test(raw))
        return "IN_PERSON";
    return "OTHER";
}
export const DAMAGE_TYPES = [
    "ELECTRICAL",
    "PLUMBING",
    "HVAC",
    "FURNITURE",
    "WALL",
    "LINEN",
    "GLASS",
    "FLOORING",
    "EQUIPMENT",
    "ELECTRONICS",
    "BATHROOM",
    "DECOR",
    "OTHER",
];
export const DAMAGE_SEVERITIES = [
    "CRITICAL",
    "MAJOR",
    "MODERATE",
    "MINOR",
];
export const DAMAGE_RESPONSIBILITIES = [
    "GUEST",
    "HOTEL",
    "NATURAL_WEAR",
    "VENDOR",
    "SPLIT",
];
export const DAMAGE_REPORT_STATUSES = [
    "REPORTED",
    "UNDER_REVIEW",
    "PENDING_FINANCE",
    "PENDING_ENGINEERING",
    "INSURANCE_CLAIM",
    "REPAIRED",
    "RECOVERED",
    "CLOSED",
    "CANCELLED",
];
export function normalizeDamageType(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (DAMAGE_TYPES.includes(raw))
        return raw;
    if (/ELECT/.test(raw))
        return "ELECTRICAL";
    if (/PLUMB|LEAK|WATER/.test(raw))
        return "PLUMBING";
    if (/HVAC|AIR.?COND|AC\b/.test(raw))
        return "HVAC";
    if (/FURN/.test(raw))
        return "FURNITURE";
    if (/WALL|PAINT/.test(raw))
        return "WALL";
    if (/LINEN|TOWEL|SHEET/.test(raw))
        return "LINEN";
    if (/GLASS|MIRROR/.test(raw))
        return "GLASS";
    if (/FLOOR|CARPET/.test(raw))
        return "FLOORING";
    if (/EQUIP/.test(raw))
        return "EQUIPMENT";
    if (/ELECTRON|TV/.test(raw))
        return "ELECTRONICS";
    if (/BATH/.test(raw))
        return "BATHROOM";
    if (/DECOR/.test(raw))
        return "DECOR";
    return "OTHER";
}
export function normalizeDamageSeverity(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (DAMAGE_SEVERITIES.includes(raw)) {
        return raw;
    }
    if (/CRIT/.test(raw))
        return "CRITICAL";
    if (/MAJOR|HIGH/.test(raw))
        return "MAJOR";
    if (/MINOR|LOW/.test(raw))
        return "MINOR";
    return "MODERATE";
}
export function normalizeDamageResponsibility(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (DAMAGE_RESPONSIBILITIES.includes(raw)) {
        return raw;
    }
    if (/GUEST/.test(raw))
        return "GUEST";
    if (/VENDOR/.test(raw))
        return "VENDOR";
    if (/NATURAL|WEAR/.test(raw))
        return "NATURAL_WEAR";
    if (/SPLIT/.test(raw))
        return "SPLIT";
    return "HOTEL";
}
export function normalizeDamageReportStatus(input) {
    const raw = String(input ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (DAMAGE_REPORT_STATUSES.includes(raw)) {
        return raw;
    }
    if (/CANCEL/.test(raw))
        return "CANCELLED";
    if (/CLOSE/.test(raw))
        return "CLOSED";
    if (/REPAIR/.test(raw))
        return "REPAIRED";
    if (/RECOVER/.test(raw))
        return "RECOVERED";
    if (/INSUR/.test(raw))
        return "INSURANCE_CLAIM";
    if (/ENGINEER/.test(raw))
        return "PENDING_ENGINEERING";
    if (/FINANCE/.test(raw))
        return "PENDING_FINANCE";
    if (/REVIEW/.test(raw))
        return "UNDER_REVIEW";
    if (/APPROV/.test(raw))
        return "UNDER_REVIEW";
    return "REPORTED";
}
//# sourceMappingURL=housekeeping.js.map
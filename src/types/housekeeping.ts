export const HK_ROOM_STATUSES = [
  "CLEAN",
  "DIRTY",
  "INSPECTING",
  "INSPECTED",
  "OUT_OF_SERVICE",
] as const;

export type HkRoomStatus = (typeof HK_ROOM_STATUSES)[number];

export interface HkRoom {
  id: string;
  roomId: string;
  status: HkRoomStatus;
  assignedTo?: string | null;
  inspectedBy?: string | null;
  lastCleanedAt?: string | null;
  lastInspectedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Enriched from rooms */
  roomNo?: string;
  roomType?: string;
  floor?: string;
  bedType?: string;
  maxOccupancy?: number;
  isActive?: boolean;
  /** Enriched from users */
  assignedToName?: string;
  inspectedByName?: string;
}

export function isHkRoomStatus(value: string): value is HkRoomStatus {
  return (HK_ROOM_STATUSES as readonly string[]).includes(value);
}

/** Map legacy UI labels to DB enum. */
export function normalizeHkRoomStatus(input: unknown): HkRoomStatus {
  const raw = String(input ?? "").trim().toUpperCase();
  if (isHkRoomStatus(raw)) return raw;
  if (/OUT.?OF.?SERVICE|OOO|OOS|BLOCKED/.test(raw)) return "OUT_OF_SERVICE";
  if (/INSPECTING|CLEANING|INSPECTION/.test(raw)) return "INSPECTING";
  if (/INSPECTED|READY/.test(raw)) return "INSPECTED";
  if (/^CLEAN$/.test(raw)) return "CLEAN";
  if (/DIRTY/.test(raw)) return "DIRTY";
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
] as const;

export type HkTaskType = (typeof HK_TASK_TYPES)[number];

export const HK_TASK_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "PENDING_INSPECTION",
  "APPROVED",
  "CANCELLED",
] as const;

export type HkTaskStatus = (typeof HK_TASK_STATUSES)[number];

export const HK_TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type HkTaskPriority = (typeof HK_TASK_PRIORITIES)[number];

export interface HkTask {
  id: string;
  taskNumber?: string;
  roomId: string;
  bookingId?: string | null;
  requestId?: string | null;
  taskType: HkTaskType;
  status: HkTaskStatus;
  assignedTo?: string | null;
  createdBy?: string | null;
  priority: HkTaskPriority;
  notes?: string | null;
  assignedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  dueAt?: string | null;
  /** Enriched — not stored */
  isOverdue?: boolean;
  roomNo?: string;
  bookingNo?: string;
  assignedToName?: string;
  createdByName?: string;
  approvedByName?: string;
  requestNumber?: string;
  requestDescription?: string;
}

export function isHkTaskType(value: string): value is HkTaskType {
  return (HK_TASK_TYPES as readonly string[]).includes(value);
}

export function isHkTaskStatus(value: string): value is HkTaskStatus {
  return (HK_TASK_STATUSES as readonly string[]).includes(value);
}

export function normalizeHkTaskType(input: unknown): HkTaskType {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isHkTaskType(raw)) return raw;
  if (/CHECKOUT|DEPARTURE/.test(raw)) return "CHECKOUT_CLEANING";
  if (/DEEP/.test(raw)) return "DEEP_CLEANING";
  if (/INSPECT/.test(raw)) return "INSPECTION";
  if (/TURN/.test(raw)) return "TURNDOWN";
  if (/GUEST|SPECIAL/.test(raw)) return "GUEST_REQUEST";
  if (/OTHER/.test(raw)) return "OTHER";
  return "REGULAR_CLEANING";
}

export function normalizeHkTaskStatus(input: unknown): HkTaskStatus {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isHkTaskStatus(raw)) return raw;
  if (/PENDING.?INSPECT|AWAITING.?INSPECT/.test(raw)) return "PENDING_INSPECTION";
  if (/PROGRESS|STARTED|CLEANING/.test(raw)) return "IN_PROGRESS";
  if (/COMPLETE|DONE|FINISH/.test(raw)) return "PENDING_INSPECTION";
  if (/APPROVE|PASS/.test(raw)) return "APPROVED";
  if (/CANCEL/.test(raw)) return "CANCELLED";
  if (/ASSIGN/.test(raw)) return "ASSIGNED";
  return "PENDING";
}

export const HK_TASK_OVERDUE_EXCLUDED_STATUSES = new Set<HkTaskStatus>([
  "COMPLETED",
  "APPROVED",
  "CANCELLED",
]);

export function computeHkTaskOverdue(task: Pick<HkTask, "dueAt" | "status">): boolean {
  if (!task.dueAt) return false;
  if (HK_TASK_OVERDUE_EXCLUDED_STATUSES.has(task.status)) return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

export function normalizeHkTaskPriority(input: unknown): HkTaskPriority {
  const raw = String(input ?? "").trim().toUpperCase();
  if ((HK_TASK_PRIORITIES as readonly string[]).includes(raw)) {
    return raw as HkTaskPriority;
  }
  return "MEDIUM";
}

export const PUBLIC_AREA_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;

export type PublicAreaPriority = (typeof PUBLIC_AREA_PRIORITIES)[number];

export interface PublicAreaMaster {
  id: string;
  areaCode: string;
  name: string;
  areaType: string;
  location?: string | null;
  floorNumber?: number | null;
  priority: PublicAreaPriority;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function normalizePublicAreaPriority(input: unknown): PublicAreaPriority {
  const raw = String(input ?? "").trim().toUpperCase();
  if ((PUBLIC_AREA_PRIORITIES as readonly string[]).includes(raw)) {
    return raw as PublicAreaPriority;
  }
  if (/LOW/.test(raw)) return "LOW";
  if (/HIGH/.test(raw)) return "HIGH";
  if (/URGENT|CRITICAL/.test(raw)) return "URGENT";
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
] as const;

export type GuestRequestType = (typeof GUEST_REQUEST_TYPES)[number];

export const GUEST_REQUEST_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type GuestRequestStatus = (typeof GUEST_REQUEST_STATUSES)[number];

export const GUEST_REQUEST_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;

export type GuestRequestPriority = (typeof GUEST_REQUEST_PRIORITIES)[number];

export interface GuestRequest {
  id: string;
  requestNumber?: string;
  roomId: string;
  bookingId?: string | null;
  requestType: GuestRequestType;
  description: string;
  status: GuestRequestStatus;
  priority: GuestRequestPriority;
  assignedTo?: string | null;
  createdBy?: string | null;
  requestedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Enriched */
  roomNo?: string;
  bookingNo?: string;
  guestName?: string;
  assignedToName?: string;
  createdByName?: string;
}

export function isGuestRequestType(value: string): value is GuestRequestType {
  return (GUEST_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isGuestRequestStatus(value: string): value is GuestRequestStatus {
  return (GUEST_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function normalizeGuestRequestType(input: unknown): GuestRequestType {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isGuestRequestType(raw)) return raw;
  if (/TOWEL/.test(raw)) return "TOWELS";
  if (/LINEN|PILLOW|BLANKET|COT/.test(raw)) return "LINEN";
  if (/CLEAN/.test(raw)) return "CLEANING";
  if (/LAUNDRY/.test(raw)) return "LAUNDRY";
  if (/MINIBAR|MINI_BAR/.test(raw)) return "MINIBAR";
  if (/AMEN|TOILETR|WATER|COFFEE|TEA|IRON|DRYER/.test(raw)) return "AMENITY";
  if (/MAINT|REPAIR/.test(raw)) return "MAINTENANCE";
  if (/ROOM.?SERVICE|FOOD/.test(raw)) return "ROOM_SERVICE";
  return "OTHER";
}

export function normalizeGuestRequestStatus(input: unknown): GuestRequestStatus {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isGuestRequestStatus(raw)) return raw;
  if (/COMPLETE|DONE|CLOSED/.test(raw)) return "COMPLETED";
  if (/PROGRESS|STARTED/.test(raw)) return "IN_PROGRESS";
  if (/ASSIGN/.test(raw)) return "ASSIGNED";
  if (/CANCEL/.test(raw)) return "CANCELLED";
  if (/OPEN|PENDING|NEW/.test(raw)) return "PENDING";
  return "PENDING";
}

export function normalizeGuestRequestPriority(
  input: unknown,
): GuestRequestPriority {
  const raw = String(input ?? "").trim().toUpperCase();
  if ((GUEST_REQUEST_PRIORITIES as readonly string[]).includes(raw)) {
    return raw as GuestRequestPriority;
  }
  if (/LOW/.test(raw)) return "LOW";
  if (/HIGH/.test(raw)) return "HIGH";
  if (/URGENT|CRITICAL/.test(raw)) return "URGENT";
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
] as const;

export type MaintenanceIssueType = (typeof MAINTENANCE_ISSUE_TYPES)[number];

export const MAINTENANCE_REQUEST_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_VERIFICATION",
  "CLOSED",
  "CANCELLED",
] as const;

export type MaintenanceRequestStatus =
  (typeof MAINTENANCE_REQUEST_STATUSES)[number];

export const MAINTENANCE_REQUEST_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type MaintenanceRequestPriority =
  (typeof MAINTENANCE_REQUEST_PRIORITIES)[number];

export interface MaintenanceRequestRow {
  id: string;
  requestNumber?: string;
  roomId?: string | null;
  publicAreaId?: string | null;
  issueType: MaintenanceIssueType;
  title: string;
  description: string;
  priority: MaintenanceRequestPriority;
  status: MaintenanceRequestStatus;
  reportedBy?: string | null;
  assignedTo?: string | null;
  reportedAt?: string | null;
  assignedAt?: string | null;
  startedAt?: string | null;
  estimatedCompletionAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  resolution?: string | null;
  notes?: string | null;
  blocksRoom?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Enriched */
  roomNo?: string;
  publicAreaName?: string;
  assignedToName?: string;
  reportedByName?: string;
  verifiedByName?: string;
}

export function isMaintenanceIssueType(
  value: string,
): value is MaintenanceIssueType {
  return (MAINTENANCE_ISSUE_TYPES as readonly string[]).includes(value);
}

export function isMaintenanceRequestStatus(
  value: string,
): value is MaintenanceRequestStatus {
  return (MAINTENANCE_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function normalizeMaintenanceIssueType(
  input: unknown,
): MaintenanceIssueType {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isMaintenanceIssueType(raw)) return raw;
  if (/ELECT/.test(raw)) return "ELECTRICAL";
  if (/PLUMB|LEAK|WATER/.test(raw)) return "PLUMBING";
  if (/HVAC|AIR.?COND|AC\b|COOL/.test(raw)) return "HVAC";
  if (/CARPENT|FURN/.test(raw)) return "CARPENTRY";
  if (/CIVIL|PAINT|DOOR|WINDOW/.test(raw)) return "CIVIL";
  if (/APPLIAN/.test(raw)) return "APPLIANCE";
  if (/IT|TV|TELEVISION|NETWORK|WIFI/.test(raw)) return "IT";
  return "OTHER";
}

export function normalizeMaintenanceRequestStatus(
  input: unknown,
): MaintenanceRequestStatus {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isMaintenanceRequestStatus(raw)) return raw;
  if (/CLOSED|DONE/.test(raw)) return "CLOSED";
  if (/AWAIT|VERIFY/.test(raw)) return "AWAITING_VERIFICATION";
  if (/PROGRESS|STARTED/.test(raw)) return "IN_PROGRESS";
  if (/ASSIGN/.test(raw)) return "ASSIGNED";
  if (/CANCEL/.test(raw)) return "CANCELLED";
  if (/OPEN|NEW|PENDING/.test(raw)) return "OPEN";
  return "OPEN";
}

export function normalizeMaintenanceRequestPriority(
  input: unknown,
): MaintenanceRequestPriority {
  const raw = String(input ?? "").trim().toUpperCase();
  if ((MAINTENANCE_REQUEST_PRIORITIES as readonly string[]).includes(raw)) {
    return raw as MaintenanceRequestPriority;
  }
  if (/LOW/.test(raw)) return "LOW";
  if (/CRITICAL/.test(raw)) return "CRITICAL";
  if (/HIGH/.test(raw)) return "HIGH";
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
] as const;

export type LostFoundCategory = (typeof LOST_FOUND_CATEGORIES)[number];

export const LOST_FOUND_STATUSES = [
  "STORED",
  "AWAITING_CLAIM",
  "UNDER_VERIFICATION",
  "CLAIMED",
  "RETURNED",
  "DISPOSED",
  "COURIER_DISPATCHED",
] as const;

export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const LOST_FOUND_RETURN_METHODS = [
  "IN_PERSON",
  "COURIER",
  "AUTHORIZED_PICKUP",
  "MAILED",
  "OTHER",
] as const;

export type LostFoundReturnMethod =
  (typeof LOST_FOUND_RETURN_METHODS)[number];

export interface LostFoundItemRow {
  id: string;
  itemNumber?: string;
  roomId?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  itemName: string;
  description?: string | null;
  category: LostFoundCategory;
  foundLocation: string;
  foundBy?: string | null;
  foundAt?: string | null;
  status: LostFoundStatus;
  storedLocation?: string | null;
  claimedBy?: string | null;
  claimedAt?: string | null;
  returnedTo?: string | null;
  returnMethod?: LostFoundReturnMethod | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Enriched */
  roomNo?: string;
  guestName?: string;
  foundByName?: string;
  claimedByName?: string;
}

export function isLostFoundCategory(value: string): value is LostFoundCategory {
  return (LOST_FOUND_CATEGORIES as readonly string[]).includes(value);
}

export function isLostFoundStatus(value: string): value is LostFoundStatus {
  return (LOST_FOUND_STATUSES as readonly string[]).includes(value);
}

export function normalizeLostFoundCategory(input: unknown): LostFoundCategory {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isLostFoundCategory(raw)) return raw;
  if (/ELECT|PHONE|LAPTOP|TV/.test(raw)) return "ELECTRONICS";
  if (/JEWEL|RING|GOLD/.test(raw)) return "JEWELRY";
  if (/CLOTH|GARMENT|SHOE/.test(raw)) return "CLOTHING";
  if (/DOC|PASSPORT|ID/.test(raw)) return "DOCUMENTS";
  if (/CASH|MONEY|WALLET/.test(raw)) return "CASH";
  if (/BAG|SUITCASE|LUGGAGE/.test(raw)) return "BAGS";
  if (/ACCESS|WATCH|GLASS/.test(raw)) return "ACCESSORIES";
  if (/MEDIC|DRUG|PILL/.test(raw)) return "MEDICINE";
  if (/KEY/.test(raw)) return "KEYS";
  if (/PERSONAL/.test(raw)) return "PERSONAL_ITEMS";
  return "OTHER";
}

export function normalizeLostFoundStatus(input: unknown): LostFoundStatus {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (isLostFoundStatus(raw)) return raw;
  if (/RETURN/.test(raw)) return "RETURNED";
  if (/CLAIM/.test(raw)) return "CLAIMED";
  if (/COURIER|DISPATCH/.test(raw)) return "COURIER_DISPATCHED";
  if (/DISPOS/.test(raw)) return "DISPOSED";
  if (/VERIF/.test(raw)) return "UNDER_VERIFICATION";
  if (/AWAIT/.test(raw)) return "AWAITING_CLAIM";
  if (/STORE/.test(raw)) return "STORED";
  return "STORED";
}

export function normalizeLostFoundReturnMethod(
  input: unknown,
): LostFoundReturnMethod | null {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if ((LOST_FOUND_RETURN_METHODS as readonly string[]).includes(raw)) {
    return raw as LostFoundReturnMethod;
  }
  if (/COURIER|SHIP|DISPATCH/.test(raw)) return "COURIER";
  if (/MAIL|POST/.test(raw)) return "MAILED";
  if (/AUTH|PICKUP/.test(raw)) return "AUTHORIZED_PICKUP";
  if (/PERSON|HAND/.test(raw)) return "IN_PERSON";
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
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export const DAMAGE_SEVERITIES = [
  "CRITICAL",
  "MAJOR",
  "MODERATE",
  "MINOR",
] as const;

export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];

export const DAMAGE_RESPONSIBILITIES = [
  "GUEST",
  "HOTEL",
  "NATURAL_WEAR",
  "VENDOR",
  "SPLIT",
] as const;

export type DamageResponsibility = (typeof DAMAGE_RESPONSIBILITIES)[number];

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
] as const;

export type DamageReportStatus = (typeof DAMAGE_REPORT_STATUSES)[number];

export interface DamageReportRow {
  id: string;
  reportNumber?: string;
  roomId?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  assetId?: string | null;
  reportedBy?: string | null;
  damageType: DamageType;
  severity: DamageSeverity;
  responsibility: DamageResponsibility;
  description: string;
  estimatedCost: number;
  actualCost?: number | null;
  status: DamageReportStatus;
  reportedAt?: string | null;
  resolvedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Enriched */
  roomNo?: string;
  guestName?: string;
  reportedByName?: string;
}

export function normalizeDamageType(input: unknown): DamageType {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if ((DAMAGE_TYPES as readonly string[]).includes(raw)) return raw as DamageType;
  if (/ELECT/.test(raw)) return "ELECTRICAL";
  if (/PLUMB|LEAK|WATER/.test(raw)) return "PLUMBING";
  if (/HVAC|AIR.?COND|AC\b/.test(raw)) return "HVAC";
  if (/FURN/.test(raw)) return "FURNITURE";
  if (/WALL|PAINT/.test(raw)) return "WALL";
  if (/LINEN|TOWEL|SHEET/.test(raw)) return "LINEN";
  if (/GLASS|MIRROR/.test(raw)) return "GLASS";
  if (/FLOOR|CARPET/.test(raw)) return "FLOORING";
  if (/EQUIP/.test(raw)) return "EQUIPMENT";
  if (/ELECTRON|TV/.test(raw)) return "ELECTRONICS";
  if (/BATH/.test(raw)) return "BATHROOM";
  if (/DECOR/.test(raw)) return "DECOR";
  return "OTHER";
}

export function normalizeDamageSeverity(input: unknown): DamageSeverity {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if ((DAMAGE_SEVERITIES as readonly string[]).includes(raw)) {
    return raw as DamageSeverity;
  }
  if (/CRIT/.test(raw)) return "CRITICAL";
  if (/MAJOR|HIGH/.test(raw)) return "MAJOR";
  if (/MINOR|LOW/.test(raw)) return "MINOR";
  return "MODERATE";
}

export function normalizeDamageResponsibility(
  input: unknown,
): DamageResponsibility {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if ((DAMAGE_RESPONSIBILITIES as readonly string[]).includes(raw)) {
    return raw as DamageResponsibility;
  }
  if (/GUEST/.test(raw)) return "GUEST";
  if (/VENDOR/.test(raw)) return "VENDOR";
  if (/NATURAL|WEAR/.test(raw)) return "NATURAL_WEAR";
  if (/SPLIT/.test(raw)) return "SPLIT";
  return "HOTEL";
}

export function normalizeDamageReportStatus(
  input: unknown,
): DamageReportStatus {
  const raw = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if ((DAMAGE_REPORT_STATUSES as readonly string[]).includes(raw)) {
    return raw as DamageReportStatus;
  }
  if (/CANCEL/.test(raw)) return "CANCELLED";
  if (/CLOSE/.test(raw)) return "CLOSED";
  if (/REPAIR/.test(raw)) return "REPAIRED";
  if (/RECOVER/.test(raw)) return "RECOVERED";
  if (/INSUR/.test(raw)) return "INSURANCE_CLAIM";
  if (/ENGINEER/.test(raw)) return "PENDING_ENGINEERING";
  if (/FINANCE/.test(raw)) return "PENDING_FINANCE";
  if (/REVIEW/.test(raw)) return "UNDER_REVIEW";
  if (/APPROV/.test(raw)) return "UNDER_REVIEW";
  return "REPORTED";
}

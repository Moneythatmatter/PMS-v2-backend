export declare const HK_ROOM_STATUSES: readonly ["CLEAN", "DIRTY", "INSPECTING", "INSPECTED", "OUT_OF_SERVICE"];
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
export declare function isHkRoomStatus(value: string): value is HkRoomStatus;
/** Map legacy UI labels to DB enum. */
export declare function normalizeHkRoomStatus(input: unknown): HkRoomStatus;
export declare const HK_TASK_TYPES: readonly ["CHECKOUT_CLEANING", "REGULAR_CLEANING", "DEEP_CLEANING", "INSPECTION", "TURNDOWN", "SPECIAL_REQUEST"];
export type HkTaskType = (typeof HK_TASK_TYPES)[number];
export declare const HK_TASK_STATUSES: readonly ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "APPROVED", "CANCELLED"];
export type HkTaskStatus = (typeof HK_TASK_STATUSES)[number];
export declare const HK_TASK_PRIORITIES: readonly ["LOW", "MEDIUM", "HIGH", "URGENT"];
export type HkTaskPriority = (typeof HK_TASK_PRIORITIES)[number];
export interface HkTask {
    id: string;
    taskNumber?: string;
    roomId: string;
    bookingId?: string | null;
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
    /** Enriched */
    roomNo?: string;
    bookingNo?: string;
    assignedToName?: string;
    createdByName?: string;
    approvedByName?: string;
}
export declare function isHkTaskType(value: string): value is HkTaskType;
export declare function isHkTaskStatus(value: string): value is HkTaskStatus;
export declare function normalizeHkTaskType(input: unknown): HkTaskType;
export declare function normalizeHkTaskStatus(input: unknown): HkTaskStatus;
export declare function normalizeHkTaskPriority(input: unknown): HkTaskPriority;
export declare const PUBLIC_AREA_PRIORITIES: readonly ["LOW", "MEDIUM", "HIGH", "URGENT"];
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
export declare function normalizePublicAreaPriority(input: unknown): PublicAreaPriority;
export declare const GUEST_REQUEST_TYPES: readonly ["AMENITY", "LINEN", "TOWELS", "CLEANING", "LAUNDRY", "MINIBAR", "MAINTENANCE", "ROOM_SERVICE", "OTHER"];
export type GuestRequestType = (typeof GUEST_REQUEST_TYPES)[number];
export declare const GUEST_REQUEST_STATUSES: readonly ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
export type GuestRequestStatus = (typeof GUEST_REQUEST_STATUSES)[number];
export declare const GUEST_REQUEST_PRIORITIES: readonly ["LOW", "MEDIUM", "HIGH", "URGENT"];
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
export declare function isGuestRequestType(value: string): value is GuestRequestType;
export declare function isGuestRequestStatus(value: string): value is GuestRequestStatus;
export declare function normalizeGuestRequestType(input: unknown): GuestRequestType;
export declare function normalizeGuestRequestStatus(input: unknown): GuestRequestStatus;
export declare function normalizeGuestRequestPriority(input: unknown): GuestRequestPriority;
export declare const MAINTENANCE_ISSUE_TYPES: readonly ["ELECTRICAL", "PLUMBING", "HVAC", "CARPENTRY", "CIVIL", "APPLIANCE", "IT", "OTHER"];
export type MaintenanceIssueType = (typeof MAINTENANCE_ISSUE_TYPES)[number];
export declare const MAINTENANCE_REQUEST_STATUSES: readonly ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_VERIFICATION", "CLOSED", "CANCELLED"];
export type MaintenanceRequestStatus = (typeof MAINTENANCE_REQUEST_STATUSES)[number];
export declare const MAINTENANCE_REQUEST_PRIORITIES: readonly ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type MaintenanceRequestPriority = (typeof MAINTENANCE_REQUEST_PRIORITIES)[number];
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
export declare function isMaintenanceIssueType(value: string): value is MaintenanceIssueType;
export declare function isMaintenanceRequestStatus(value: string): value is MaintenanceRequestStatus;
export declare function normalizeMaintenanceIssueType(input: unknown): MaintenanceIssueType;
export declare function normalizeMaintenanceRequestStatus(input: unknown): MaintenanceRequestStatus;
export declare function normalizeMaintenanceRequestPriority(input: unknown): MaintenanceRequestPriority;

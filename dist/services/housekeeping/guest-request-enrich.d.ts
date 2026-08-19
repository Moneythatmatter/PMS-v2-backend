import type { GuestRequest } from "../../types/housekeeping.js";
/** Resolve hk_staff id from UI staff name or id. */
export declare function resolveGuestRequestAssignee(input: unknown): Promise<string | null>;
/** Human-readable staff label for notes / API enrichment. */
export declare function resolveGuestRequestAssigneeLabel(input: unknown): Promise<string>;
/** Insert/update with fallback when legacy users FK is still on assigned_to. */
export declare function persistGuestRequestRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, assigneeLabel: string): Promise<GuestRequest>;
export declare function sanitizeGuestRequestInput(input: Record<string, unknown>): Record<string, unknown>;
export declare function enrichGuestRequest(row: GuestRequest): Promise<GuestRequest>;
export declare function enrichGuestRequests(rows: GuestRequest[]): Promise<GuestRequest[]>;
export declare function resolveGuestRequestId(key: string): Promise<string | null>;
export declare function resolveRoomIdForGuestRequest(key: string): Promise<string | null>;

import { resolveGuestRequestAssignee, resolveGuestRequestAssigneeLabel } from "./guest-request-enrich.js";
import type { MaintenanceRequestRow } from "../../types/housekeeping.js";
export declare const resolveMaintenanceAssignee: typeof resolveGuestRequestAssignee;
export declare const resolveMaintenanceAssigneeLabel: typeof resolveGuestRequestAssigneeLabel;
export declare function persistMaintenanceRequestRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, staffNotes?: {
    assigned?: string;
    reported?: string;
    verified?: string;
}): Promise<MaintenanceRequestRow>;
export declare function sanitizeMaintenanceRequestInput(input: Record<string, unknown>): Record<string, unknown>;
export declare function enrichMaintenanceRequest(row: MaintenanceRequestRow): Promise<MaintenanceRequestRow>;
export declare function enrichMaintenanceRequests(rows: MaintenanceRequestRow[]): Promise<MaintenanceRequestRow[]>;
export declare function resolveMaintenanceRequestId(key: string): Promise<string | null>;
export declare function resolveRoomIdForMaintenance(key: string): Promise<string | null>;
export declare function resolvePublicAreaId(key: string): Promise<string | null>;
/** Parse legacy "2 Hours" / "24 Hours" into ISO timestamp from base time. */
export declare function parseEstimatedCompletionAt(input: unknown, base?: Date): string | null;

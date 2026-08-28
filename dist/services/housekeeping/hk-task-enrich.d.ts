import { resolveGuestRequestAssignee, resolveGuestRequestAssigneeLabel } from "./guest-request-enrich.js";
import type { HkTask } from "../../types/housekeeping.js";
export declare const resolveHkTaskAssignee: typeof resolveGuestRequestAssignee;
export declare const resolveHkTaskAssigneeLabel: typeof resolveGuestRequestAssigneeLabel;
/** Update/create tasks with fallback when users FK is still present. */
export declare function persistHkTaskRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, staffLabels?: {
    assigned?: string;
    created?: string;
    approved?: string;
}): Promise<HkTask>;
export declare function sanitizeHkTaskInput(input: Record<string, unknown>): Record<string, unknown>;
export type HkTaskScheduleInput = {
    scheduledDate?: string | null;
    scheduledStartAt?: string | null;
    dueAt?: string | null;
};
export declare function parseHkTaskScheduleInput(input: Record<string, unknown>): HkTaskScheduleInput;
export declare function buildHkTaskSchedulePayload(input: HkTaskScheduleInput): Record<string, unknown>;
export declare function enrichHkTask(row: HkTask): Promise<HkTask>;
export declare function enrichHkTasks(rows: HkTask[]): Promise<HkTask[]>;
export declare function resolveHkTaskId(key: string): Promise<string | null>;
export declare function resolveRoomIdForTask(key: string): Promise<string | null>;

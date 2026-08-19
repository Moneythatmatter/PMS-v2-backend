import type { HkTask } from "../../types/housekeeping.js";
export declare function sanitizeHkTaskInput(input: Record<string, unknown>): Record<string, unknown>;
export declare function enrichHkTask(row: HkTask): Promise<HkTask>;
export declare function enrichHkTasks(rows: HkTask[]): Promise<HkTask[]>;
export declare function resolveHkTaskId(key: string): Promise<string | null>;
export declare function resolveRoomIdForTask(key: string): Promise<string | null>;

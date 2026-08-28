import type { HkRoom } from "../../types/housekeeping.js";
/** Update/create hk_rooms with fallback when users FK is still present. */
export declare function persistHkRoomRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, staffLabels?: {
    assigned?: string;
    inspected?: string;
}): Promise<HkRoom>;
export declare function sanitizeHkRoomInput(input: Record<string, unknown>): Record<string, unknown>;
declare function resolveRoomId(key: string): Promise<string | null>;
export declare function resolveHkRoomId(key: string): Promise<string | null>;
export declare function enrichHkRoom(row: HkRoom): Promise<HkRoom>;
export declare function enrichHkRooms(rows: HkRoom[]): Promise<HkRoom[]>;
export { resolveRoomId };

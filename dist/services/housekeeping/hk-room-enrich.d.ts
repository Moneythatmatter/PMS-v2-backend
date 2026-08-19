import type { HkRoom } from "../../types/housekeeping.js";
export declare function sanitizeHkRoomInput(input: Record<string, unknown>): Record<string, unknown>;
declare function resolveRoomId(key: string): Promise<string | null>;
export declare function resolveHkRoomId(key: string): Promise<string | null>;
export declare function enrichHkRoom(row: HkRoom): Promise<HkRoom>;
export declare function enrichHkRooms(rows: HkRoom[]): Promise<HkRoom[]>;
export { resolveRoomId };

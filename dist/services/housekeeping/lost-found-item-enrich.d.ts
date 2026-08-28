import type { LostFoundItemRow } from "../../types/housekeeping.js";
export declare function sanitizeLostFoundItemInput(input: Record<string, unknown>): Record<string, unknown>;
export declare function persistLostFoundItemRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, foundByLabel?: string): Promise<LostFoundItemRow>;
export declare function enrichLostFoundItem(row: LostFoundItemRow): Promise<LostFoundItemRow>;
export declare function enrichLostFoundItems(rows: LostFoundItemRow[]): Promise<LostFoundItemRow[]>;
export declare function resolveLostFoundItemId(key: string): Promise<string | null>;
export declare function resolveRoomIdForLostFound(key: string): Promise<string | null>;
export declare function resolveGuestIdByName(input: unknown): Promise<string | null>;
export declare function resolveFoundByUserId(input: unknown): Promise<string | null>;
export declare function resolveFoundByUserLabel(input: unknown): Promise<string>;
export declare function parseFoundAt(input: unknown, fallback?: Date): string;

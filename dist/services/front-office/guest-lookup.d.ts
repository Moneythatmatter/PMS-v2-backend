import type { Guest } from "../../types/front-office.js";
/** Load guest by UUID id or display guest_no (e.g. G-12). */
export declare function getGuestByKey(key: string): Promise<Guest | null>;
export declare function guestDisplayNo(row: Partial<Guest>): string;
/** Strip auto-assigned guest_no from API writes. */
export declare function sanitizeGuestInput(input: Record<string, unknown>): Record<string, unknown>;
/** Reject create/update when mobile or email belongs to another guest profile. */
export declare function assertGuestContactUnique(body: Record<string, unknown>, excludeGuestId?: string): Promise<void>;

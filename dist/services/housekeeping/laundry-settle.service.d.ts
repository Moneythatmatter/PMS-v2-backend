export declare const LAUNDRY_SOURCE_TYPE = "LAUNDRY";
export declare const FOLIO_CHARGE_MODE = "Room Charge";
export declare function isLaundryFolioCharge(method?: string): boolean;
/**
 * Folio (Room Charge) settlement.
 * Prefers atomic Postgres RPC; falls back to app-level post if RPC not installed.
 */
export declare function settleLaundryFolioViaRpc(input: {
    jobId: string;
    bookingId: string;
    guestId?: string | null;
    amount: number;
    notes?: string | null;
    /** Existing job row (for timeline packing when billing columns absent). */
    job?: Record<string, unknown> | null;
}): Promise<Record<string, unknown>>;
/** Counter payment — Cash / Card / UPI (not posted to guest folio balance). */
export declare function settleLaundryCounter(input: {
    jobId: string;
    amount: number;
    paymentMethod: string;
    bookingId?: string | null;
    guestId?: string | null;
    receivedBy?: string | null;
    notes?: string | null;
    externalReference?: string | null;
}): Promise<import("../../types/transactions.js").Transaction>;

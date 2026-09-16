export declare const ROOM_SERVICE_SOURCE_TYPE = "ROOM_SERVICE";
export declare const ROOM_SERVICE_REVERSAL_SOURCE_TYPE = "ROOM_SERVICE_REVERSAL";
export declare function isRoomChargePayment(method?: string): boolean;
export declare function isRoomChargeSettledOrder(order: {
    type?: unknown;
    paymentMode?: unknown;
    payment_mode?: unknown;
} | null | undefined): boolean;
/** Atomic Room Charge settlement via Postgres RPC. */
export declare function settleRoomChargeViaRpc(input: {
    billId: string;
    orderId: string;
    bookingId: string;
    guestId?: string | null;
    amount: number;
    notes?: string | null;
}): Promise<Record<string, unknown>>;
/** Atomic bill + folio sync after cancellation on Room Charge bills. */
export declare function syncRoomServiceAfterCancellationViaRpc(input: {
    billId: string;
    orderId: string;
    newSubtotal: number;
    newTax?: number;
    newDiscount?: number;
    newTotal: number;
    reversalNotes?: string | null;
}): Promise<Record<string, unknown>>;

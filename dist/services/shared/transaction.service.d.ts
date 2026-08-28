import type { RecordTransactionInput, Transaction } from "../../types/transactions.js";
declare function normalizePaymentMethod(mode?: string): string;
/**
 * Cross-module payment ledger — FO checkout, reservation advance, F&B orders, etc.
 */
export declare const TransactionService: {
    list(filters?: {
        bookingId?: string;
        folioId?: string;
        guestId?: string;
        sourceModule?: string;
        sourceId?: string;
        status?: string;
    }): Promise<Transaction[]>;
    get(id: string): Promise<Transaction | null>;
    create(input: RecordTransactionInput): Promise<Transaction>;
    /** Postgres RPC — auto transaction_number + single atomic insert. */
    recordViaRpc(input: RecordTransactionInput): Promise<Transaction>;
    ensureFolioForBooking(bookingId: string, guestId?: string | null): Promise<string>;
    /** Map legacy UI payment mode strings to enum. */
    normalizePaymentMethod: typeof normalizePaymentMethod;
    /** FO checkout — folio + booking linked, optional UPI/card ref in externalReference. */
    recordFrontOfficePayment(input: {
        amount: number;
        paymentMethod?: string;
        bookingId?: string | null;
        guestId?: string | null;
        folioId?: string | null;
        externalReference?: string | null;
        receivedBy?: string | null;
        notes?: string | null;
    }): Promise<Transaction>;
    /** F&B order payment — no folio required. */
    recordFnbPayment(input: {
        amount: number;
        orderId: string;
        paymentMethod?: string;
        externalReference?: string | null;
        receivedBy?: string | null;
        notes?: string | null;
    }): Promise<Transaction>;
    /** Reservation advance / deposit before check-in. */
    recordReservationAdvance(input: {
        amount: number;
        bookingId: string;
        guestId?: string | null;
        paymentMethod?: string;
        externalReference?: string | null;
        receivedBy?: string | null;
        notes?: string | null;
    }): Promise<Transaction>;
};
export {};

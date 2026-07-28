import type { Payment } from "../../types/front-office.js";
export type RecordPaymentInput = {
    guestName: string;
    amount: number;
    mode: string;
    room?: string | null;
    reservationId?: string | null;
    type?: string;
    transactionNo?: string;
    date?: string;
    status?: string;
};
/**
 * PaymentService — all payment recording / future refunds & split pay live here.
 */
export declare const PaymentService: {
    record(input: RecordPaymentInput): Promise<Payment>;
};

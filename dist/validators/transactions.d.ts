import { z } from "zod";
export declare const transactionCreateSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    transactionType: z.ZodOptional<z.ZodEnum<{
        PAYMENT: "PAYMENT";
        REFUND: "REFUND";
        ADJUSTMENT: "ADJUSTMENT";
    }>>;
    paymentMethod: z.ZodOptional<z.ZodEnum<{
        OTHER: "OTHER";
        CASH: "CASH";
        CARD: "CARD";
        UPI: "UPI";
        BANK_TRANSFER: "BANK_TRANSFER";
        CHEQUE: "CHEQUE";
    }>>;
    currency: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        PENDING: "PENDING";
        COMPLETED: "COMPLETED";
        FAILED: "FAILED";
        VOIDED: "VOIDED";
        REFUNDED: "REFUNDED";
    }>>;
    folioId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    bookingId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guestId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    sourceModule: z.ZodNullable<z.ZodOptional<z.ZodEnum<{
        OTHER: "OTHER";
        MAINTENANCE: "MAINTENANCE";
        FRONT_OFFICE: "FRONT_OFFICE";
        FNB: "FNB";
        RESERVATION: "RESERVATION";
        HOUSEKEEPING: "HOUSEKEEPING";
        ACCOUNTS: "ACCOUNTS";
    }>>>;
    sourceId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    externalReference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    receivedBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    transactionDate: z.ZodOptional<z.ZodString>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$loose>;
export declare const transactionUpdateSchema: z.ZodObject<{
    amount: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    transactionType: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        PAYMENT: "PAYMENT";
        REFUND: "REFUND";
        ADJUSTMENT: "ADJUSTMENT";
    }>>>;
    paymentMethod: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        OTHER: "OTHER";
        CASH: "CASH";
        CARD: "CARD";
        UPI: "UPI";
        BANK_TRANSFER: "BANK_TRANSFER";
        CHEQUE: "CHEQUE";
    }>>>;
    currency: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    status: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        PENDING: "PENDING";
        COMPLETED: "COMPLETED";
        FAILED: "FAILED";
        VOIDED: "VOIDED";
        REFUNDED: "REFUNDED";
    }>>>;
    folioId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    bookingId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    guestId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    sourceModule: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodEnum<{
        OTHER: "OTHER";
        MAINTENANCE: "MAINTENANCE";
        FRONT_OFFICE: "FRONT_OFFICE";
        FNB: "FNB";
        RESERVATION: "RESERVATION";
        HOUSEKEEPING: "HOUSEKEEPING";
        ACCOUNTS: "ACCOUNTS";
    }>>>>;
    sourceId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    externalReference: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    receivedBy: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    transactionDate: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    notes: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
}, z.core.$loose>;
export declare const foPaymentSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    paymentMethod: z.ZodOptional<z.ZodString>;
    bookingId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guestId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    folioId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    externalReference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    receivedBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const fnbPaymentSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    orderId: z.ZodString;
    paymentMethod: z.ZodOptional<z.ZodString>;
    externalReference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    receivedBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const reservationAdvanceSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    bookingId: z.ZodString;
    guestId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    paymentMethod: z.ZodOptional<z.ZodString>;
    externalReference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    receivedBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;

import { z } from "zod";
const transactionType = z.enum(["PAYMENT", "REFUND", "ADJUSTMENT"]);
const paymentMethod = z.enum([
    "CASH",
    "CARD",
    "UPI",
    "BANK_TRANSFER",
    "CHEQUE",
    "OTHER",
]);
const transactionStatus = z.enum([
    "PENDING",
    "COMPLETED",
    "FAILED",
    "VOIDED",
    "REFUNDED",
]);
const sourceModule = z.enum([
    "FRONT_OFFICE",
    "FNB",
    "RESERVATION",
    "HOUSEKEEPING",
    "MAINTENANCE",
    "ACCOUNTS",
    "OTHER",
]);
export const transactionCreateSchema = z
    .object({
    amount: z.coerce.number().min(0),
    transactionType: transactionType.optional(),
    paymentMethod: paymentMethod.optional(),
    currency: z.string().length(3).optional(),
    status: transactionStatus.optional(),
    folioId: z.string().optional().nullable(),
    bookingId: z.string().optional().nullable(),
    guestId: z.string().optional().nullable(),
    sourceModule: sourceModule.optional().nullable(),
    sourceId: z.string().optional().nullable(),
    externalReference: z.string().optional().nullable(),
    receivedBy: z.string().optional().nullable(),
    transactionDate: z.string().optional(),
    notes: z.string().optional().nullable(),
})
    .passthrough();
export const transactionUpdateSchema = transactionCreateSchema.partial();
export const foPaymentSchema = z.object({
    amount: z.coerce.number().positive(),
    paymentMethod: z.string().optional(),
    bookingId: z.string().optional().nullable(),
    guestId: z.string().optional().nullable(),
    folioId: z.string().optional().nullable(),
    externalReference: z.string().optional().nullable(),
    receivedBy: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});
export const fnbPaymentSchema = z.object({
    amount: z.coerce.number().positive(),
    orderId: z.string().min(1),
    paymentMethod: z.string().optional(),
    externalReference: z.string().optional().nullable(),
    receivedBy: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});
export const reservationAdvanceSchema = z.object({
    amount: z.coerce.number().positive(),
    bookingId: z.string().min(1),
    guestId: z.string().optional().nullable(),
    paymentMethod: z.string().optional(),
    externalReference: z.string().optional().nullable(),
    receivedBy: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});
//# sourceMappingURL=transactions.js.map
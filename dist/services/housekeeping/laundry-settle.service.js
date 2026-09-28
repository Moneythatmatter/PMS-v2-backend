import { supabase } from "../../utils/supabase.js";
import { AppError } from "../../errors/index.js";
import { TransactionService } from "../shared/transaction.service.js";
import { foModel } from "../../models/front-office/index.js";
import { hkModel } from "../../models/housekeeping/index.js";
export const LAUNDRY_SOURCE_TYPE = "LAUNDRY";
export const FOLIO_CHARGE_MODE = "Room Charge";
export function isLaundryFolioCharge(method) {
    return /room\s*charge|folio/i.test(String(method ?? "").trim());
}
function isMissingRpcError(message) {
    return /Could not find the function|schema cache|does not exist/i.test(message);
}
/**
 * Folio (Room Charge) settlement.
 * Prefers atomic Postgres RPC; falls back to app-level post if RPC not installed.
 */
export async function settleLaundryFolioViaRpc(input) {
    const { data, error } = await supabase.rpc("hk_settle_laundry_folio_charge", {
        p_job_id: input.jobId,
        p_booking_id: input.bookingId,
        p_guest_id: input.guestId ?? null,
        p_amount: Number(input.amount),
        p_notes: input.notes ?? null,
    });
    if (!error) {
        return (data ?? {});
    }
    if (!isMissingRpcError(error.message)) {
        throw new AppError(error.message, 400);
    }
    return settleLaundryFolioAppLevel(input);
}
/** App-level Room Charge when hk_settle_laundry_folio_charge RPC is absent. */
async function settleLaundryFolioAppLevel(input) {
    const amount = Number(input.amount);
    if (!(amount > 0)) {
        throw new AppError("Settlement amount must be > 0", 400);
    }
    const existing = await TransactionService.list({
        sourceModule: "HOUSEKEEPING",
        sourceType: LAUNDRY_SOURCE_TYPE,
        sourceId: input.jobId,
        status: "COMPLETED",
    });
    if (existing.length > 0) {
        throw new AppError("Laundry charge already posted for this job", 400);
    }
    const folioId = await TransactionService.ensureFolioForBooking(input.bookingId, input.guestId ?? null);
    const txn = await TransactionService.recordViaRpc({
        amount,
        transactionType: "ADJUSTMENT",
        paymentMethod: "OTHER",
        folioId,
        bookingId: input.bookingId,
        guestId: input.guestId ?? null,
        sourceModule: "HOUSEKEEPING",
        sourceType: LAUNDRY_SOURCE_TYPE,
        sourceId: input.jobId,
        notes: input.notes ??
            `[LAUNDRY] charge — job ${input.jobId}`,
    });
    // Bump folio subtotal
    const folio = await foModel.get(foModel.tables.folios, folioId);
    if (folio) {
        await foModel.update(foModel.tables.folios, folioId, {
            subtotal: Math.max(0, Number(folio.subtotal ?? 0) + amount),
        });
    }
    // Bump reservation laundry charge
    const booking = await foModel.get(foModel.tables.reservations, input.bookingId);
    if (booking) {
        await foModel.update(foModel.tables.reservations, input.bookingId, {
            laundry: Math.max(0, Number(booking.laundry ?? 0) + amount),
        });
    }
    const paidAt = new Date().toISOString();
    const jobBase = input.job ?? {};
    const timeline = {
        ...(jobBase.timeline ?? {}),
        ext: {
            ...(jobBase.timeline?.ext ?? {}),
            billingStatus: "Folio",
            paymentMode: FOLIO_CHARGE_MODE,
            paidAt,
            folioId,
            bookingId: input.bookingId,
            guestId: input.guestId ?? null,
        },
    };
    await hkModel.update(hkModel.tables.laundryJobs, input.jobId, {
        billingStatus: "Folio",
        paymentMode: FOLIO_CHARGE_MODE,
        paidAt,
        folioId,
        bookingId: input.bookingId,
        guestId: input.guestId ?? null,
        timeline,
    });
    return {
        jobId: input.jobId,
        folioId,
        transactionId: txn.id,
        amount,
        billingStatus: "Folio",
    };
}
/** Counter payment — Cash / Card / UPI (not posted to guest folio balance). */
export async function settleLaundryCounter(input) {
    if (!(Number(input.amount) > 0)) {
        throw new AppError("Payment amount must be > 0", 400);
    }
    return TransactionService.recordViaRpc({
        amount: Number(input.amount),
        transactionType: "PAYMENT",
        paymentMethod: TransactionService.normalizePaymentMethod(input.paymentMethod),
        folioId: null,
        sourceModule: "HOUSEKEEPING",
        sourceType: LAUNDRY_SOURCE_TYPE,
        sourceId: input.jobId,
        bookingId: input.bookingId ?? null,
        guestId: input.guestId ?? null,
        receivedBy: input.receivedBy ?? null,
        externalReference: input.externalReference ?? null,
        notes: input.notes ??
            `[LAUNDRY] counter settlement — job ${input.jobId} (${input.paymentMethod})`,
    });
}
//# sourceMappingURL=laundry-settle.service.js.map
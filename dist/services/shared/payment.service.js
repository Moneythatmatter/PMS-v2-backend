import { foModel } from "../../models/front-office/index.js";
import { PaymentStatus, PaymentType, } from "../../constants/front-office.js";
import { formatDate } from "../../utils/date.js";
import { IdService } from "./id.service.js";
import { AppError } from "../../errors/index.js";
/**
 * PaymentService — all payment recording / future refunds & split pay live here.
 */
export const PaymentService = {
    async record(input) {
        if (!input.guestName?.trim()) {
            throw new AppError("guestName is required for payment");
        }
        if (!(Number(input.amount) > 0)) {
            throw new AppError("Payment amount must be greater than 0");
        }
        if (!input.mode?.trim()) {
            throw new AppError("Payment mode is required");
        }
        const row = await foModel.create(foModel.tables.payments, {
            id: IdService.generatePayment(),
            guestName: input.guestName,
            room: input.room ?? null,
            reservationId: input.reservationId ?? null,
            amount: Number(input.amount),
            mode: input.mode,
            type: input.type ?? PaymentType.PAYMENT,
            transactionNo: input.transactionNo ?? IdService.generateTransactionNo(),
            date: input.date ?? formatDate(),
            status: input.status ?? PaymentStatus.COMPLETED,
        });
        return row;
    },
};
//# sourceMappingURL=payment.service.js.map
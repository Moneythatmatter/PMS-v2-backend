import { foModel } from "../../models/front-office/index.js";
import { FoBillingResponsibility, FoChargeCategory, } from "../../constants/front-office.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { TransactionService } from "./transaction.service.js";
function normalizeCategory(raw) {
    const key = String(raw ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    const allowed = Object.values(FoChargeCategory);
    if (!allowed.includes(key)) {
        throw new AppError(`Unsupported charge category: ${raw}`);
    }
    return key;
}
/**
 * Resolve which folio should hold a charge for a reservation,
 * using fo_group_billing_rules when the stay belongs to a group.
 * Individual bookings always route to the stay folio (GUEST).
 */
export const ChargeRouterService = {
    async resolveForReservation(reservationId, chargeCategory) {
        const category = normalizeCategory(chargeCategory);
        const reservation = await foModel.get(foModel.tables.reservations, reservationId);
        if (!reservation)
            throw new NotFoundError("Reservation not found");
        const groupId = reservation.groupId?.trim() || null;
        if (!groupId) {
            const folioId = await TransactionService.ensureFolioForBooking(reservationId, reservation.guestId ?? null);
            return {
                folioId,
                groupId: null,
                reservationId,
                responsibility: FoBillingResponsibility.GUEST,
                chargeCategory: category,
            };
        }
        const rules = await foModel.list(foModel.tables.foGroupBillingRules, {
            filters: { group_id: groupId },
        });
        const rule = rules.find((r) => String(r.chargeCategory).toUpperCase() === category ||
            String(r.charge_category ?? "")
                .toUpperCase() === category);
        const responsibility = (rule?.responsibility
            ? String(rule.responsibility).toUpperCase()
            : FoBillingResponsibility.GUEST);
        if (responsibility === FoBillingResponsibility.GROUP_OWNER) {
            const folioId = await TransactionService.ensureFolioForGroup(groupId);
            return {
                folioId,
                groupId,
                reservationId,
                responsibility,
                chargeCategory: category,
            };
        }
        const folioId = await TransactionService.ensureFolioForBooking(reservationId, reservation.guestId ?? null);
        return {
            folioId,
            groupId,
            reservationId,
            responsibility: FoBillingResponsibility.GUEST,
            chargeCategory: category,
        };
    },
};
//# sourceMappingURL=charge-router.service.js.map
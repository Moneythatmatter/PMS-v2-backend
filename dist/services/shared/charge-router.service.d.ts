import { type FoBillingResponsibilityValue, type FoChargeCategoryValue } from "../../constants/front-office.js";
export type ChargeRouteTarget = {
    folioId: string;
    groupId: string | null;
    reservationId: string | null;
    responsibility: FoBillingResponsibilityValue;
    chargeCategory: FoChargeCategoryValue;
};
/**
 * Resolve which folio should hold a charge for a reservation,
 * using fo_group_billing_rules when the stay belongs to a group.
 * Individual bookings always route to the stay folio (GUEST).
 */
export declare const ChargeRouterService: {
    resolveForReservation(reservationId: string, chargeCategory: string): Promise<ChargeRouteTarget>;
};

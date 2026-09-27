import { foModel } from "../../models/front-office/index.js";
import {
  FoBillingResponsibility,
  FoChargeCategory,
  type FoBillingResponsibilityValue,
  type FoChargeCategoryValue,
} from "../../constants/front-office.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { TransactionService } from "./transaction.service.js";
import type { Reservation } from "../../types/front-office.js";

export type ChargeRouteTarget = {
  folioId: string;
  groupId: string | null;
  reservationId: string | null;
  responsibility: FoBillingResponsibilityValue;
  chargeCategory: FoChargeCategoryValue;
};

function normalizeCategory(raw: string): FoChargeCategoryValue {
  const key = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const allowed = Object.values(FoChargeCategory) as string[];
  if (!allowed.includes(key)) {
    throw new AppError(`Unsupported charge category: ${raw}`);
  }
  return key as FoChargeCategoryValue;
}

/**
 * Resolve which folio should hold a charge for a reservation,
 * using fo_group_billing_rules when the stay belongs to a group.
 * Individual bookings always route to the stay folio (GUEST).
 */
export const ChargeRouterService = {
  async resolveForReservation(
    reservationId: string,
    chargeCategory: string,
  ): Promise<ChargeRouteTarget> {
    const category = normalizeCategory(chargeCategory);
    const reservation = await foModel.get<Reservation>(
      foModel.tables.reservations,
      reservationId,
    );
    if (!reservation) throw new NotFoundError("Reservation not found");

    const groupId = reservation.groupId?.trim() || null;
    if (!groupId) {
      const folioId = await TransactionService.ensureFolioForBooking(
        reservationId,
        reservation.guestId ?? null,
      );
      return {
        folioId,
        groupId: null,
        reservationId,
        responsibility: FoBillingResponsibility.GUEST,
        chargeCategory: category,
      };
    }

    const rules = await foModel.list<{
      chargeCategory: string;
      responsibility: string;
    }>(foModel.tables.foGroupBillingRules, {
      filters: { group_id: groupId },
    });

    const rule = rules.find(
      (r) =>
        String(r.chargeCategory).toUpperCase() === category ||
        String((r as { charge_category?: string }).charge_category ?? "")
          .toUpperCase() === category,
    );

    const responsibility = (
      rule?.responsibility
        ? String(rule.responsibility).toUpperCase()
        : FoBillingResponsibility.GUEST
    ) as FoBillingResponsibilityValue;

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

    const folioId = await TransactionService.ensureFolioForBooking(
      reservationId,
      reservation.guestId ?? null,
    );
    return {
      folioId,
      groupId,
      reservationId,
      responsibility: FoBillingResponsibility.GUEST,
      chargeCategory: category,
    };
  },
};

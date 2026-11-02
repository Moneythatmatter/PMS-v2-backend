import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import type { Folio, FolioCharge } from "../../types/transactions.js";
import type { Reservation } from "../../types/front-office.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { ChargeRouterService } from "./charge-router.service.js";
import {
  FoBillingResponsibility,
  ReservationStatus,
  type FoChargeCategoryValue,
} from "../../constants/front-office.js";
import { chargeBillingPoint, quoteBillingPoint } from "../accounts/tax-resolver.js";
import { currentBusinessDate } from "../front-office/business-date.js";

const CHARGE_BLOCKED_STATUSES = new Set<string>([
  ReservationStatus.CANCELLED,
  ReservationStatus.NO_SHOW,
  ReservationStatus.CHECKED_OUT,
]);

/** Reservation columns that checkout reads to split the folio subtotal. */
const RESERVATION_CHARGE_COLUMN: Partial<Record<string, string>> = {
  FOOD_BEVERAGE: "restaurantBill",
  LAUNDRY: "laundry",
};

/** Split a charge into taxable amount + tax using the billing point's tax rules (none when unmapped). */
async function quoteManualCharge(category: string, amount: number) {
  const point = chargeBillingPoint(category, "MANUAL_CHARGE");
  const { businessDate: date } = await currentBusinessDate();
  const result = await quoteBillingPoint(point, amount, date);
  if (!result.configured) return { taxable: amount, tax: 0, lines: [], date };
  if (!result.quote.ok) throw new AppError(`Tax setup incomplete — ${result.quote.issue}`, 409);
  return { taxable: result.quote.taxableAmount, tax: result.quote.taxAmount, lines: result.quote.lines, date };
}

export type PostManualChargeInput = {
  bookingId: string;
  chargeCategory: string;
  description: string;
  quantity?: number;
  unitPrice: number;
};

export type PostFolioChargeInput = {
  reservationId: string;
  chargeCategory: FoChargeCategoryValue | string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  sourceModule?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  createdBy?: string | null;
  /** When set, skip router and post directly to this folio. */
  folioId?: string | null;
  groupId?: string | null;
  guestId?: string | null;
  responsibility?: string | null;
};

async function recalcFolio(folioId: string): Promise<void> {
  const { error } = await supabase.rpc("fo_recalc_folio_from_charges", {
    p_folio_id: folioId,
  });
  if (error) throw new Error(error.message);
}

export const FolioChargeService = {
  async list(filters: {
    folioId?: string;
    groupId?: string;
    reservationId?: string;
  } = {}): Promise<FolioCharge[]> {
    return foModel.list<FolioCharge>(foModel.tables.folioCharges, {
      filters: {
        folio_id: filters.folioId,
        group_id: filters.groupId,
        reservation_id: filters.reservationId,
      },
      orderBy: "created_at",
      ascending: false,
    });
  },

  async recalc(folioId: string): Promise<void> {
    await recalcFolio(folioId);
  },

  /**
   * Insert a charge onto the paying folio (via charge router unless folioId given),
   * then recalc folio header from charges.
   */
  async post(input: PostFolioChargeInput): Promise<FolioCharge> {
    const reservationId = String(input.reservationId ?? "").trim();
    if (!reservationId && !input.folioId) {
      throw new AppError("reservationId or folioId is required");
    }

    let folioId = input.folioId?.trim() || "";
    let groupId = input.groupId?.trim() || null;
    let responsibility = input.responsibility ?? null;
    let category = String(input.chargeCategory ?? "OTHER").toUpperCase();

    if (!folioId) {
      const route = await ChargeRouterService.resolveForReservation(
        reservationId,
        category,
      );
      folioId = route.folioId;
      groupId = route.groupId;
      responsibility = route.responsibility;
      category = route.chargeCategory;
    }

    const quantity = Number(input.quantity ?? 1);
    const unitPrice = Number(input.unitPrice ?? 0);
    const amount =
      input.amount != null
        ? Number(input.amount)
        : Math.round(quantity * unitPrice * 100) / 100;

    if (!(amount >= 0)) {
      throw new AppError("Charge amount must be >= 0");
    }

    const row = await foModel.create<FolioCharge>(foModel.tables.folioCharges, {
      propertyId: getActivePropertyId() ?? null,
      folioId,
      groupId,
      reservationId: reservationId || null,
      bookingId: reservationId || null,
      guestId: input.guestId ?? null,
      chargeCategory: category,
      description: input.description ?? "",
      quantity,
      unitPrice,
      amount,
      responsibility,
      sourceModule: input.sourceModule ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      createdBy: input.createdBy ?? null,
    });

    await recalcFolio(folioId);
    return toCamel<FolioCharge>(row as unknown as Record<string, unknown>);
  },

  /**
   * Front-desk charge on a booking. Individual folios keep room revenue as a
   * seeded subtotal (no ROOM charge rows), so the subtotal is incremented
   * instead of recalculated from folio_charges.
   */
  async postManual(input: PostManualChargeInput): Promise<FolioCharge> {
    const reservation = await foModel.get<Reservation>(
      foModel.tables.reservations,
      input.bookingId,
    );
    if (!reservation) throw new NotFoundError("Reservation not found");
    const status = String(reservation.status ?? "");
    if (CHARGE_BLOCKED_STATUSES.has(status)) {
      throw new AppError(`Charges cannot be posted to a ${status.toLowerCase()} booking`);
    }

    const route = await ChargeRouterService.resolveForReservation(
      reservation.id,
      input.chargeCategory,
    );
    const folio = await foModel.get<Folio>(foModel.tables.folios, route.folioId);
    if (!folio) throw new NotFoundError("Folio not found");
    if (folio.status !== "OPEN") {
      throw new AppError("Folio is closed — charges can no longer be posted");
    }

    const quantity = Number(input.quantity ?? 1);
    const unitPrice = Number(input.unitPrice);
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    if (!(amount > 0)) throw new AppError("Charge amount must be greater than 0");
    const quote = await quoteManualCharge(route.chargeCategory, amount);

    const row = await foModel.create<FolioCharge>(foModel.tables.folioCharges, {
      propertyId: getActivePropertyId() ?? null,
      folioId: folio.id,
      groupId: route.groupId,
      reservationId: reservation.id,
      bookingId: reservation.id,
      guestId: reservation.guestId ?? null,
      chargeCategory: route.chargeCategory,
      description: input.description,
      quantity,
      unitPrice,
      amount: quote.taxable,
      taxAmount: quote.tax,
      taxDetails: quote.lines,
      businessDate: quote.date,
      responsibility: route.responsibility,
      sourceModule: "FRONT_OFFICE",
      sourceType: "MANUAL_CHARGE",
      createdBy: getRequestStore()?.userId ?? null,
    });

    await foModel.update(foModel.tables.folios, folio.id, {
      subtotal: Math.round((Number(folio.subtotal ?? 0) + quote.taxable) * 100) / 100,
      taxTotal: Math.round((Number(folio.taxTotal ?? 0) + quote.tax) * 100) / 100,
    });

    const column = RESERVATION_CHARGE_COLUMN[route.chargeCategory];
    if (column && route.responsibility === FoBillingResponsibility.GUEST) {
      const current = Number((reservation as unknown as Record<string, unknown>)[column] ?? 0);
      await foModel.update(foModel.tables.reservations, reservation.id, {
        [column]: Math.max(0, current + quote.taxable),
      });
    }

    return toCamel<FolioCharge>(row as unknown as Record<string, unknown>);
  },
};

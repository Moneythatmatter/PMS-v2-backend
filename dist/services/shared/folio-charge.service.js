import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { ChargeRouterService } from "./charge-router.service.js";
async function recalcFolio(folioId) {
    const { error } = await supabase.rpc("fo_recalc_folio_from_charges", {
        p_folio_id: folioId,
    });
    if (error)
        throw new Error(error.message);
}
export const FolioChargeService = {
    async list(filters = {}) {
        return foModel.list(foModel.tables.folioCharges, {
            filters: {
                folio_id: filters.folioId,
                group_id: filters.groupId,
                reservation_id: filters.reservationId,
            },
            orderBy: "created_at",
            ascending: false,
        });
    },
    async recalc(folioId) {
        await recalcFolio(folioId);
    },
    /**
     * Insert a charge onto the paying folio (via charge router unless folioId given),
     * then recalc folio header from charges.
     */
    async post(input) {
        const reservationId = String(input.reservationId ?? "").trim();
        if (!reservationId && !input.folioId) {
            throw new AppError("reservationId or folioId is required");
        }
        let folioId = input.folioId?.trim() || "";
        let groupId = input.groupId?.trim() || null;
        let responsibility = input.responsibility ?? null;
        let category = String(input.chargeCategory ?? "OTHER").toUpperCase();
        if (!folioId) {
            const route = await ChargeRouterService.resolveForReservation(reservationId, category);
            folioId = route.folioId;
            groupId = route.groupId;
            responsibility = route.responsibility;
            category = route.chargeCategory;
        }
        const quantity = Number(input.quantity ?? 1);
        const unitPrice = Number(input.unitPrice ?? 0);
        const amount = input.amount != null
            ? Number(input.amount)
            : Math.round(quantity * unitPrice * 100) / 100;
        if (!(amount >= 0)) {
            throw new AppError("Charge amount must be >= 0");
        }
        const row = await foModel.create(foModel.tables.folioCharges, {
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
        return toCamel(row);
    },
};
//# sourceMappingURL=folio-charge.service.js.map
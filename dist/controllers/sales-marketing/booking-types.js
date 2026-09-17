import { smModel, smTables, SYSTEM_BOOKING_TYPES } from "../../models/sales-marketing/index.js";
import { fromError, ok } from "../../utils/response.js";
export async function ensureSystemBookingTypes(_req, res) {
    try {
        const existing = await smModel.list(smTables.bookingTypes, { orderBy: "sort_order" });
        const existingCodes = new Set(existing.map((row) => String(row.code)));
        for (const item of SYSTEM_BOOKING_TYPES) {
            if (existingCodes.has(item.code))
                continue;
            await smModel.create(smTables.bookingTypes, {
                id: smModel.newId("SMBT"),
                code: item.code,
                is_system: true,
                central_type: item.centralType,
                lead_type: item.leadType,
                card_label: item.cardLabel,
                short_label: item.shortLabel,
                description: item.description,
                beo_required: item.beoRequired,
                handover_note: "handoverNote" in item ? item.handoverNote : null,
                icon_key: item.iconKey,
                sort_order: item.sortOrder,
                enabled: true,
            });
        }
        const rows = await smModel.list(smTables.bookingTypes, { orderBy: "sort_order" });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listBookingTypes(_req, res) {
    try {
        let rows = await smModel.list(smTables.bookingTypes, { orderBy: "sort_order" });
        if (rows.length === 0) {
            for (const item of SYSTEM_BOOKING_TYPES) {
                await smModel.create(smTables.bookingTypes, {
                    id: smModel.newId("SMBT"),
                    code: item.code,
                    is_system: true,
                    central_type: item.centralType,
                    lead_type: item.leadType,
                    card_label: item.cardLabel,
                    short_label: item.shortLabel,
                    description: item.description,
                    beo_required: item.beoRequired,
                    handover_note: "handoverNote" in item ? item.handoverNote : null,
                    icon_key: item.iconKey,
                    sort_order: item.sortOrder,
                    enabled: true,
                });
            }
            rows = await smModel.list(smTables.bookingTypes, { orderBy: "sort_order" });
        }
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=booking-types.js.map
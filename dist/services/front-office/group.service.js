import { randomUUID } from "crypto";
import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { FoBillingResponsibility, FoChargeCategory, FoGroupStatus, } from "../../constants/front-office.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { enrichReservations } from "./reservation-enrich.js";
import { FolioService } from "../shared/folio.service.js";
import { TransactionService } from "../shared/transaction.service.js";
function nightsBetween(arrival, departure) {
    const a = Date.parse(arrival);
    const b = Date.parse(departure);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
        return 1;
    return Math.max(1, Math.round((b - a) / 86_400_000));
}
function defaultBillingRules() {
    return [
        {
            chargeCategory: FoChargeCategory.ROOM,
            responsibility: FoBillingResponsibility.GROUP_OWNER,
        },
        {
            chargeCategory: FoChargeCategory.FOOD_BEVERAGE,
            responsibility: FoBillingResponsibility.GUEST,
        },
        {
            chargeCategory: FoChargeCategory.MINIBAR,
            responsibility: FoBillingResponsibility.GUEST,
        },
        {
            chargeCategory: FoChargeCategory.LAUNDRY,
            responsibility: FoBillingResponsibility.GUEST,
        },
        {
            chargeCategory: FoChargeCategory.OTHER,
            responsibility: FoBillingResponsibility.GUEST,
        },
    ];
}
export const GroupService = {
    async list(status) {
        return foModel.list(foModel.tables.foGroups, {
            filters: status ? { status } : undefined,
            orderBy: "created_at",
            ascending: false,
        });
    },
    async getById(id) {
        const row = await foModel.get(foModel.tables.foGroups, id);
        if (!row)
            throw new NotFoundError("Group not found");
        return row;
    },
    async listReservations(groupId) {
        await this.getById(groupId);
        const rows = await foModel.list(foModel.tables.reservations, {
            filters: { group_id: groupId },
            orderBy: "created_at",
            ascending: true,
        });
        return enrichReservations(rows);
    },
    async listBillingRules(groupId) {
        await this.getById(groupId);
        return foModel.list(foModel.tables.foGroupBillingRules, {
            filters: { group_id: groupId },
            orderBy: "charge_category",
            ascending: true,
        });
    },
    async getMasterFolio(groupId) {
        await this.getById(groupId);
        const folios = await FolioService.list({ groupId });
        const open = folios.find((f) => f.status === "OPEN" && !f.bookingId);
        if (open)
            return open;
        const any = folios.find((f) => !f.bookingId);
        if (any)
            return any;
        // Heal: ensure_folio_for_group historically omitted property_id, so
        // property-scoped list hid an existing master folio.
        const propertyId = getActivePropertyId();
        const { data, error } = await supabase
            .from(foModel.tables.folios)
            .select("id, property_id, status")
            .eq("group_id", groupId)
            .is("booking_id", null)
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error)
            throw new Error(error.message);
        if (!data?.id)
            return null;
        if (propertyId && data.property_id == null) {
            const { error: updErr } = await supabase
                .from(foModel.tables.folios)
                .update({ property_id: propertyId })
                .eq("id", data.id);
            if (updErr)
                throw new Error(updErr.message);
        }
        return FolioService.getById(String(data.id));
    },
    async ensureMasterFolio(groupId) {
        const folioId = await TransactionService.ensureFolioForGroup(groupId);
        const folio = await FolioService.getById(folioId);
        if (!folio)
            throw new NotFoundError("Master folio not found");
        return folio;
    },
    async updateBillingRules(groupId, rules) {
        await this.getById(groupId);
        const propertyId = getActivePropertyId();
        for (const rule of rules) {
            const category = String(rule.chargeCategory ?? "")
                .trim()
                .toUpperCase();
            const responsibility = String(rule.responsibility ?? "")
                .trim()
                .toUpperCase();
            if (!Object.values(FoChargeCategory).includes(category)) {
                throw new AppError(`Invalid charge category: ${rule.chargeCategory}`);
            }
            if (!Object.values(FoBillingResponsibility).includes(responsibility)) {
                throw new AppError(`Invalid responsibility: ${rule.responsibility}`);
            }
            const existing = await foModel.list(foModel.tables.foGroupBillingRules, {
                filters: {
                    group_id: groupId,
                    charge_category: category,
                },
                limit: 1,
            });
            if (existing[0]) {
                await foModel.update(foModel.tables.foGroupBillingRules, existing[0].id, {
                    responsibility,
                });
            }
            else {
                await foModel.create(foModel.tables.foGroupBillingRules, {
                    propertyId: propertyId ?? null,
                    groupId,
                    chargeCategory: category,
                    responsibility,
                });
            }
        }
        return this.listBillingRules(groupId);
    },
    async create(input) {
        const propertyId = getActivePropertyId();
        if (!propertyId) {
            throw new AppError("X-Property-Id is required to create a group", 400);
        }
        const groupName = String(input.groupName ?? "").trim();
        if (!groupName)
            throw new AppError("groupName is required");
        const arrivalDate = String(input.arrivalDate ?? "").trim();
        const departureDate = String(input.departureDate ?? "").trim();
        if (!arrivalDate || !departureDate) {
            throw new AppError("arrivalDate and departureDate are required");
        }
        const roomLines = (input.roomLines ?? []).filter((l) => String(l.roomType ?? "").trim());
        if (!roomLines.length) {
            throw new AppError("At least one room line is required");
        }
        const nights = input.nights && Number(input.nights) > 0
            ? Number(input.nights)
            : nightsBetween(arrivalDate, departureDate);
        const idempotencyKey = String(input.idempotencyKey ?? "").trim() || randomUUID();
        const billingRules = input.billingRules && input.billingRules.length > 0
            ? input.billingRules
            : defaultBillingRules();
        const { data, error } = await supabase.rpc("fo_create_group", {
            p_property_id: propertyId,
            p_idempotency_key: idempotencyKey,
            p_group_name: groupName,
            p_group_type: input.groupType ?? "Other",
            p_contact_guest_id: input.contactGuestId ?? null,
            p_contact_name: input.contactName ?? null,
            p_contact_phone: input.contactPhone ?? null,
            p_contact_email: input.contactEmail ?? null,
            p_company_name: input.companyName ?? null,
            p_arrival_date: arrivalDate,
            p_departure_date: departureDate,
            p_nights: nights,
            p_notes: input.notes ?? null,
            p_created_by: input.createdBy ?? null,
            p_room_lines: roomLines.map((l) => ({
                roomType: l.roomType,
                quantity: Math.max(1, Number(l.quantity ?? 1)),
                roomRate: Number(l.roomRate ?? 0),
                tariffPlan: l.tariffPlan ?? null,
                mealPlan: l.mealPlan ?? null,
                adults: Math.max(0, Number(l.adults ?? 1)),
                children: Math.max(0, Number(l.children ?? 0)),
            })),
            p_billing_rules: billingRules.map((r) => ({
                chargeCategory: String(r.chargeCategory).toUpperCase(),
                responsibility: String(r.responsibility).toUpperCase(),
            })),
        });
        if (error)
            throw new Error(error.message);
        const payload = toCamel(data);
        const reservationIds = Array.isArray(payload.reservationIds)
            ? payload.reservationIds.map(String)
            : [];
        // Heal property_id until ensure_* RPCs are re-applied with property_id on insert
        if (payload.masterFolioId) {
            await supabase
                .from(foModel.tables.folios)
                .update({ property_id: propertyId })
                .eq("id", payload.masterFolioId)
                .is("property_id", null);
        }
        if (reservationIds.length) {
            await supabase
                .from(foModel.tables.folios)
                .update({ property_id: propertyId })
                .in("booking_id", reservationIds)
                .is("property_id", null);
        }
        const advancePaid = Number(input.advancePaid ?? 0);
        let masterFolioId = payload.masterFolioId ?? null;
        // Skip on idempotent replay so a client retry does not double-post the deposit.
        if (advancePaid > 0 && !payload.idempotent) {
            const paymentMode = String(input.paymentMode ?? "").trim();
            if (!paymentMode) {
                throw new AppError("Payment method is required when advance amount is collected");
            }
            if (!masterFolioId) {
                masterFolioId = await TransactionService.ensureFolioForGroup(payload.groupId);
                await supabase
                    .from(foModel.tables.folios)
                    .update({ property_id: propertyId })
                    .eq("id", masterFolioId)
                    .is("property_id", null);
            }
            await TransactionService.recordGroupAdvance({
                amount: advancePaid,
                groupId: payload.groupId,
                folioId: masterFolioId,
                paymentMethod: paymentMode,
                externalReference: String(input.externalReference ?? "").trim() || null,
                notes: "Group booking advance payment",
            });
        }
        const group = await this.getById(payload.groupId);
        return {
            groupId: payload.groupId,
            idempotent: Boolean(payload.idempotent),
            reservationIds,
            masterFolioId,
            group,
        };
    },
    async update(id, input) {
        const existing = await this.getById(id);
        const groupName = input.groupName !== undefined
            ? String(input.groupName ?? "").trim()
            : existing.groupName;
        if (!groupName)
            throw new AppError("Group name is required");
        const arrivalDate = input.arrivalDate !== undefined
            ? String(input.arrivalDate ?? "").trim()
            : existing.arrivalDate;
        const departureDate = input.departureDate !== undefined
            ? String(input.departureDate ?? "").trim()
            : existing.departureDate;
        if (!arrivalDate || !departureDate) {
            throw new AppError("Arrival and departure dates are required");
        }
        if (Date.parse(departureDate) <= Date.parse(arrivalDate)) {
            throw new AppError("Departure date must be after arrival date");
        }
        const patch = {
            groupName,
            groupType: input.groupType !== undefined
                ? String(input.groupType ?? "").trim() || null
                : existing.groupType ?? null,
            contactName: input.contactName !== undefined
                ? String(input.contactName ?? "").trim() || null
                : existing.contactName ?? null,
            contactPhone: input.contactPhone !== undefined
                ? String(input.contactPhone ?? "").trim() || null
                : existing.contactPhone ?? null,
            contactEmail: input.contactEmail !== undefined
                ? String(input.contactEmail ?? "").trim() || null
                : existing.contactEmail ?? null,
            companyName: input.companyName !== undefined
                ? String(input.companyName ?? "").trim() || null
                : existing.companyName ?? null,
            arrivalDate,
            departureDate,
            notes: input.notes !== undefined
                ? String(input.notes ?? "").trim() || null
                : existing.notes ?? null,
            updatedAt: new Date().toISOString(),
        };
        if (input.status !== undefined) {
            patch.status = String(input.status ?? "").trim() || existing.status;
        }
        if (input.updatedBy !== undefined) {
            patch.updatedBy = input.updatedBy;
        }
        await foModel.update(foModel.tables.foGroups, id, patch);
        const datesChanged = arrivalDate !== existing.arrivalDate ||
            departureDate !== existing.departureDate;
        if (datesChanged) {
            const nights = nightsBetween(arrivalDate, departureDate);
            const children = await foModel.list(foModel.tables.reservations, {
                filters: { group_id: id },
            });
            for (const child of children) {
                const status = String(child.status ?? "").trim();
                if (status === "Checked In" ||
                    status === "In-House" ||
                    status === "Checked Out" ||
                    status === "Cancelled" ||
                    status === "No Show") {
                    continue;
                }
                await foModel.update(foModel.tables.reservations, child.id, {
                    checkIn: arrivalDate,
                    checkOut: departureDate,
                    nights,
                });
            }
        }
        return this.getById(id);
    },
};
export { FoGroupStatus };
//# sourceMappingURL=group.service.js.map
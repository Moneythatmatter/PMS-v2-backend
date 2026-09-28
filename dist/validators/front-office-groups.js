import { z } from "zod";
import { nonEmptyString, nonNegativeNumber } from "../utils/validate.js";
import { FoBillingResponsibility, FoChargeCategory, } from "../constants/front-office.js";
const chargeCategoryEnum = z.enum(Object.values(FoChargeCategory));
const responsibilityEnum = z.enum(Object.values(FoBillingResponsibility));
export const groupRoomLineSchema = z.object({
    roomType: nonEmptyString("roomType"),
    quantity: z.coerce.number().int().min(1).optional(),
    roomRate: nonNegativeNumber.optional(),
    tariffPlan: z.string().optional().nullable(),
    mealPlan: z.string().optional().nullable(),
    adults: z.coerce.number().int().min(0).optional(),
    children: z.coerce.number().int().min(0).optional(),
});
export const groupBillingRuleSchema = z.object({
    chargeCategory: chargeCategoryEnum,
    responsibility: responsibilityEnum,
});
export const groupCreateSchema = z
    .object({
    groupName: nonEmptyString("groupName"),
    groupType: z.string().optional(),
    contactGuestId: z.string().optional().nullable(),
    contactName: z.string().optional().nullable(),
    contactPhone: z.string().optional().nullable(),
    contactEmail: z.string().optional().nullable(),
    companyName: z.string().optional().nullable(),
    arrivalDate: nonEmptyString("arrivalDate"),
    departureDate: nonEmptyString("departureDate"),
    nights: z.coerce.number().int().min(1).optional(),
    notes: z.string().optional().nullable(),
    idempotencyKey: z.string().optional(),
    roomLines: z.array(groupRoomLineSchema).min(1),
    billingRules: z.array(groupBillingRuleSchema).optional(),
    advancePaid: nonNegativeNumber.optional(),
    paymentMode: z.string().optional().nullable(),
    externalReference: z.string().optional().nullable(),
    createdBy: z.string().optional().nullable(),
})
    .passthrough();
export const groupBillingRulesUpdateSchema = z
    .object({
    rules: z.array(groupBillingRuleSchema).min(1),
})
    .passthrough();
export const groupUpdateSchema = z
    .object({
    groupName: z.string().min(1).optional(),
    groupType: z.string().optional().nullable(),
    contactName: z.string().optional().nullable(),
    contactPhone: z.string().optional().nullable(),
    contactEmail: z.string().optional().nullable(),
    companyName: z.string().optional().nullable(),
    arrivalDate: z.string().optional(),
    departureDate: z.string().optional(),
    notes: z.string().optional().nullable(),
    status: z.string().optional(),
    updatedBy: z.string().optional().nullable(),
})
    .passthrough();
//# sourceMappingURL=front-office-groups.js.map
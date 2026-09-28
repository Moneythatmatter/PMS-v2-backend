import { z } from "zod";
export declare const groupRoomLineSchema: z.ZodObject<{
    roomType: z.ZodString;
    quantity: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    roomRate: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    tariffPlan: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    mealPlan: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    adults: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    children: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const groupBillingRuleSchema: z.ZodObject<{
    chargeCategory: z.ZodEnum<{
        [x: string]: string;
    }>;
    responsibility: z.ZodEnum<{
        [x: string]: string;
    }>;
}, z.core.$strip>;
export declare const groupCreateSchema: z.ZodObject<{
    groupName: z.ZodString;
    groupType: z.ZodOptional<z.ZodString>;
    contactGuestId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactEmail: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    companyName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    arrivalDate: z.ZodString;
    departureDate: z.ZodString;
    nights: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
    roomLines: z.ZodArray<z.ZodObject<{
        roomType: z.ZodString;
        quantity: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        roomRate: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        tariffPlan: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        mealPlan: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        adults: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        children: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>>;
    billingRules: z.ZodOptional<z.ZodArray<z.ZodObject<{
        chargeCategory: z.ZodEnum<{
            [x: string]: string;
        }>;
        responsibility: z.ZodEnum<{
            [x: string]: string;
        }>;
    }, z.core.$strip>>>;
    advancePaid: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    paymentMode: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    externalReference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    createdBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$loose>;
export declare const groupBillingRulesUpdateSchema: z.ZodObject<{
    rules: z.ZodArray<z.ZodObject<{
        chargeCategory: z.ZodEnum<{
            [x: string]: string;
        }>;
        responsibility: z.ZodEnum<{
            [x: string]: string;
        }>;
    }, z.core.$strip>>;
}, z.core.$loose>;
export declare const groupUpdateSchema: z.ZodObject<{
    groupName: z.ZodOptional<z.ZodString>;
    groupType: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contactEmail: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    companyName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    arrivalDate: z.ZodOptional<z.ZodString>;
    departureDate: z.ZodOptional<z.ZodString>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    status: z.ZodOptional<z.ZodString>;
    updatedBy: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$loose>;

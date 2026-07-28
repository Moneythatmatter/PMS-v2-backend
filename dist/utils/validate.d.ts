import { z, type ZodTypeAny } from "zod";
export declare function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T>;
/** Optional email: allow empty string, otherwise must be valid. */
export declare const optionalEmail: z.ZodOptional<z.ZodString>;
export declare const nonEmptyString: (label: string) => z.ZodString;
export declare const nonNegativeNumber: z.ZodCoercedNumber<unknown>;
export declare const positiveNumber: z.ZodCoercedNumber<unknown>;

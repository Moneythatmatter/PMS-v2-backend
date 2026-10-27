import { z } from "zod";
import {
  nonEmptyString,
  nonNegativeNumber,
  optionalEmail,
  positiveNumber,
} from "../utils/validate.js";

/** Create guest — required identity fields. */
export const guestCreateSchema = z
  .object({
    id: z.string().optional(),
    name: nonEmptyString("name"),
    mobile: nonEmptyString("mobile"),
    email: optionalEmail,
    nationality: z.string().optional(),
    loyaltyPoints: z.coerce.number().int().min(0).optional(),
    idType: z.string().optional(),
    idNumber: z.string().optional(),
    address: z.string().optional(),
    memberSince: z.string().optional(),
    preferences: z.array(z.string()).optional(),
    gender: z.string().optional(),
    dob: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    pincode: z.string().optional(),
  })
  .passthrough();

/** Update guest — all fields optional, but validated when present. */
export const guestUpdateSchema = guestCreateSchema.partial().passthrough();

/** ~5 MB file once base64-encoded. */
const MAX_DOCUMENT_DATA_URL_LENGTH = 7_000_000;

export const guestDocumentCreateSchema = z.object({
  id: z.string().optional(),
  guestId: nonEmptyString("guestId"),
  reservationId: z.string().optional().nullable(),
  documentType: z.string().optional().nullable(),
  fileName: nonEmptyString("fileName"),
  mimeType: z.string().optional().nullable(),
  fileSize: z.coerce.number().int().min(0).optional(),
  dataUrl: z
    .string()
    .startsWith("data:", "dataUrl must be a data URL")
    .max(MAX_DOCUMENT_DATA_URL_LENGTH, "File is too large (max 5 MB)"),
  uploadedBy: z.string().optional().nullable(),
});

export const guestDocumentUpdateSchema = z.object({
  documentType: z.string().optional().nullable(),
  reservationId: z.string().optional().nullable(),
});

const reservationFieldsSchema = z
  .object({
    id: z.string().optional(),
    guestId: z.string().optional().nullable(),
    groupId: z.string().optional().nullable(),
    guestName: z.string().optional(),
    phone: z.string().optional(),
    email: optionalEmail,
    sourceId: z.string().optional().nullable(),
    source: z.string().optional(),
    roomRefId: z.string().optional().nullable(),
    roomNo: z.string().optional().nullable(),
    roomType: z.string().optional(),
    checkIn: nonEmptyString("checkIn"),
    checkOut: nonEmptyString("checkOut"),
    balance: nonNegativeNumber.optional(),
    status: z.string().optional(),
    arrivingToday: z.boolean().optional(),
    bookingType: z.string().optional(),
    companyName: z.string().optional(),
    adults: z.coerce.number().int().min(0).optional(),
    children: z.coerce.number().int().min(0).optional(),
    nights: z.coerce.number().int().min(0).optional(),
    roomRate: nonNegativeNumber.optional(),
    totalAmount: nonNegativeNumber.optional(),
    advancePaid: nonNegativeNumber.optional(),
    paymentMode: z.string().optional(),
    externalReference: z.string().optional().nullable(),
    paymentReference: z.string().optional().nullable(), // legacy alias → externalReference
    specialRequests: z.string().optional(),
    bookedBy: z.string().optional(),
    createdAt: z.string().optional(),
    isVip: z.boolean().optional(),
  })
  .passthrough();

/** Create — guestId required unless groupId is set (group TBA children). */
export const reservationCreateSchema = reservationFieldsSchema.superRefine(
  (data, ctx) => {
    const groupId = String(data.groupId ?? "").trim();
    const guestId = String(data.guestId ?? "").trim();
    if (!groupId && !guestId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guestId"],
        message: "guestId is required",
      });
    }
  },
);

/** Update — partial of fields only (Zod v4 cannot .partial() refined schemas). */
export const reservationUpdateSchema = reservationFieldsSchema.partial().passthrough();

export const paymentCreateSchema = z
  .object({
    id: z.string().optional(),
    guestName: nonEmptyString("guestName"),
    room: z.string().optional(),
    reservationId: z.string().optional().nullable(),
    amount: positiveNumber,
    mode: nonEmptyString("mode"),
    type: z.string().optional(),
    transactionNo: nonEmptyString("transactionNo"),
    date: nonEmptyString("date"),
    status: z.string().optional(),
  })
  .passthrough();

export const paymentUpdateSchema = paymentCreateSchema.partial().passthrough();

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
    totalStays: z.coerce.number().int().min(0).optional(),
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

export const reservationCreateSchema = z
  .object({
    id: z.string().optional(),
    guestId: nonEmptyString("guestId"),
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
    specialRequests: z.string().optional(),
    bookedBy: z.string().optional(),
    createdAt: z.string().optional(),
    isVip: z.boolean().optional(),
  })
  .passthrough();

export const reservationUpdateSchema = reservationCreateSchema
  .partial()
  .passthrough();

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

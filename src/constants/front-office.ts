/** Domain constants — avoid magic strings across services. */

export const ReservationStatus = {
  CONFIRMED: "Confirmed",
  RESERVED: "Reserved",
  CHECKED_IN: "Checked In",
  IN_HOUSE: "In-House",
  CHECKED_OUT: "Checked Out",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
} as const;

export type ReservationStatusValue =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const BookingType = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
  GROUP: "Group",
} as const;

export const FoChargeCategory = {
  ROOM: "ROOM",
  FOOD_BEVERAGE: "FOOD_BEVERAGE",
  MINIBAR: "MINIBAR",
  LAUNDRY: "LAUNDRY",
  OTHER: "OTHER",
} as const;

export type FoChargeCategoryValue =
  (typeof FoChargeCategory)[keyof typeof FoChargeCategory];

export const FoBillingResponsibility = {
  GROUP_OWNER: "GROUP_OWNER",
  GUEST: "GUEST",
} as const;

export type FoBillingResponsibilityValue =
  (typeof FoBillingResponsibility)[keyof typeof FoBillingResponsibility];

export const FoGroupStatus = {
  CONFIRMED: "Confirmed",
  PARTIAL: "Partial",
  IN_HOUSE: "In-House",
  CHECKED_OUT: "Checked Out",
  CANCELLED: "Cancelled",
} as const;

export const RoomStatus = {
  VACANT: "Vacant",
  RESERVED: "Reserved",
  OCCUPIED: "Occupied",
  DIRTY: "Dirty",
  CLEAN: "Clean",
  MAINTENANCE: "Maintenance",
  OUT_OF_ORDER: "Out of Order",
} as const;

export const HousekeepingStatus = {
  CLEAN: "Clean",
  DIRTY: "Dirty",
  INSPECTED: "Inspected",
} as const;

export const PaymentStatus = {
  COMPLETED: "Completed",
  PENDING: "Pending",
  FAILED: "Failed",
  REFUNDED: "Refunded",
} as const;

export const PaymentType = {
  PAYMENT: "Payment",
  REFUND: "Refund",
  ADVANCE: "Advance",
} as const;

export const ActivityType = {
  RESERVATION_CREATED: "RESERVATION_CREATED",
  CHECK_IN: "CHECK_IN",
  CHECK_OUT: "CHECK_OUT",
  EXTEND_STAY: "EXTEND_STAY",
  PAYMENT: "PAYMENT",
} as const;

export type ActivityTypeValue =
  (typeof ActivityType)[keyof typeof ActivityType];

/** Domain constants — avoid magic strings across services. */

export const ReservationStatus = {
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked In",
  IN_HOUSE: "In-House",
  CHECKED_OUT: "Checked Out",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
} as const;

export type ReservationStatusValue =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const RoomStatus = {
  VACANT: "Vacant",
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

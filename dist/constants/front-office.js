/** Domain constants — avoid magic strings across services. */
export const ReservationStatus = {
    CONFIRMED: "Confirmed",
    RESERVED: "Reserved",
    CHECKED_IN: "Checked In",
    IN_HOUSE: "In-House",
    CHECKED_OUT: "Checked Out",
    CANCELLED: "Cancelled",
    NO_SHOW: "No Show",
};
export const BookingType = {
    INDIVIDUAL: "Individual",
    COMPANY: "Company",
    GROUP: "Group",
};
export const FoChargeCategory = {
    ROOM: "ROOM",
    FOOD_BEVERAGE: "FOOD_BEVERAGE",
    MINIBAR: "MINIBAR",
    LAUNDRY: "LAUNDRY",
    OTHER: "OTHER",
};
export const FoBillingResponsibility = {
    GROUP_OWNER: "GROUP_OWNER",
    GUEST: "GUEST",
};
export const FoGroupStatus = {
    CONFIRMED: "Confirmed",
    PARTIAL: "Partial",
    IN_HOUSE: "In-House",
    CHECKED_OUT: "Checked Out",
    CANCELLED: "Cancelled",
};
export const RoomStatus = {
    VACANT: "Vacant",
    RESERVED: "Reserved",
    OCCUPIED: "Occupied",
    DIRTY: "Dirty",
    CLEAN: "Clean",
    MAINTENANCE: "Maintenance",
    OUT_OF_ORDER: "Out of Order",
};
export const HousekeepingStatus = {
    CLEAN: "Clean",
    DIRTY: "Dirty",
    INSPECTED: "Inspected",
};
export const PaymentStatus = {
    COMPLETED: "Completed",
    PENDING: "Pending",
    FAILED: "Failed",
    REFUNDED: "Refunded",
};
export const PaymentType = {
    PAYMENT: "Payment",
    REFUND: "Refund",
    ADVANCE: "Advance",
};
export const ActivityType = {
    RESERVATION_CREATED: "RESERVATION_CREATED",
    CHECK_IN: "CHECK_IN",
    CHECK_OUT: "CHECK_OUT",
    EXTEND_STAY: "EXTEND_STAY",
    PAYMENT: "PAYMENT",
};
//# sourceMappingURL=front-office.js.map
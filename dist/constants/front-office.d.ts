/** Domain constants — avoid magic strings across services. */
export declare const ReservationStatus: {
    readonly CONFIRMED: "Confirmed";
    readonly RESERVED: "Reserved";
    readonly CHECKED_IN: "Checked In";
    readonly IN_HOUSE: "In-House";
    readonly CHECKED_OUT: "Checked Out";
    readonly CANCELLED: "Cancelled";
    readonly NO_SHOW: "No Show";
};
export type ReservationStatusValue = (typeof ReservationStatus)[keyof typeof ReservationStatus];
export declare const RoomStatus: {
    readonly VACANT: "Vacant";
    readonly RESERVED: "Reserved";
    readonly OCCUPIED: "Occupied";
    readonly DIRTY: "Dirty";
    readonly CLEAN: "Clean";
    readonly MAINTENANCE: "Maintenance";
    readonly OUT_OF_ORDER: "Out of Order";
};
export declare const HousekeepingStatus: {
    readonly CLEAN: "Clean";
    readonly DIRTY: "Dirty";
    readonly INSPECTED: "Inspected";
};
export declare const PaymentStatus: {
    readonly COMPLETED: "Completed";
    readonly PENDING: "Pending";
    readonly FAILED: "Failed";
    readonly REFUNDED: "Refunded";
};
export declare const PaymentType: {
    readonly PAYMENT: "Payment";
    readonly REFUND: "Refund";
    readonly ADVANCE: "Advance";
};
export declare const ActivityType: {
    readonly RESERVATION_CREATED: "RESERVATION_CREATED";
    readonly CHECK_IN: "CHECK_IN";
    readonly CHECK_OUT: "CHECK_OUT";
    readonly EXTEND_STAY: "EXTEND_STAY";
    readonly PAYMENT: "PAYMENT";
};
export type ActivityTypeValue = (typeof ActivityType)[keyof typeof ActivityType];

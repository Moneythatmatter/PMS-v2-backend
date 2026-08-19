import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, } from "./base.js";
export const tables = {
    roomTypes: "room_types",
    rooms: "rooms",
    tariffPlans: "tariff_plans",
    marketSegments: "market_segments",
    companies: "companies",
    bookingSources: "booking_sources",
    guests: "guests",
    reservations: "reservations",
    guestStayHistory: "guest_stay_history",
    folioEntries: "folio_entries",
    payments: "payments",
    invoices: "invoices",
    roomTransfers: "room_transfers",
    wakeUpCalls: "wake_up_calls",
    taxiBookings: "taxi_bookings",
    luggageItems: "luggage_items",
    messages: "messages",
    guestFeedback: "guest_feedback",
    lostFoundItems: "lost_found_items",
    housekeepingRequests: "housekeeping_requests",
    maintenanceRequests: "maintenance_requests",
    cashierShifts: "cashier_shifts",
    roomChargePostings: "room_charge_postings",
    dayClosings: "day_closings",
    deskActivity: "desk_activity",
};
export const foModel = {
    list: listRows,
    get: getRowById,
    create: insertRow,
    update: updateRow,
    remove: deleteRow,
    newId,
    newCode,
    tables,
};
/** Map taxi `drop` UI field to DB `drop_location`. */
export function normalizeTaxiPayload(body) {
    const { drop, dropLocation, ...rest } = body;
    return {
        ...rest,
        dropLocation: dropLocation ?? drop,
    };
}
/** Map taxi row back for UI (`drop`). */
export function mapTaxiForUi(row) {
    const r = row;
    const { dropLocation, ...rest } = r;
    return { ...rest, drop: dropLocation ?? "" };
}
//# sourceMappingURL=index.js.map
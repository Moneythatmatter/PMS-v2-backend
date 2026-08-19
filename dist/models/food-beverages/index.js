import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, } from "../front-office/base.js";
export const fbTables = {
    outlets: "fb_outlets",
    liveTables: "fb_live_tables",
    orders: "fb_orders",
    kdsTickets: "fb_kds_tickets",
    cashierShifts: "fb_cashier_shifts",
    reservations: "fb_reservations",
    menuCategories: "fb_menu_categories",
    menuItems: "fb_menu_items",
    modifiers: "fb_modifiers",
    combos: "fb_combos",
    pricingRules: "fb_pricing_rules",
    banquetBookings: "fb_banquet_bookings",
    banquetPackages: "fb_banquet_packages",
    banquetRequirements: "fb_banquet_requirements",
    banquetBilling: "fb_banquet_billing",
    ingredients: "fb_ingredients",
    suppliers: "fb_suppliers",
    purchaseOrders: "fb_purchase_orders",
    grn: "fb_grn",
    stockMovements: "fb_stock_movements",
    wastage: "fb_wastage",
    stockCounts: "fb_stock_counts",
    stockAdjustments: "fb_stock_adjustments",
    drinkCategories: "fb_drink_categories",
    drinks: "fb_drinks",
    cocktails: "fb_cocktails",
    happyHour: "fb_happy_hour",
    barStock: "fb_bar_stock",
    bottleTracking: "fb_bottle_tracking",
    taxes: "fb_taxes",
    discounts: "fb_discounts",
    paymentModes: "fb_payment_modes",
    orderTypes: "fb_order_types",
    dayClosings: "fb_day_closings",
};
export const fbModel = {
    list: listRows,
    get: getRowById,
    create: insertRow,
    update: updateRow,
    remove: deleteRow,
    newId,
    newCode,
    tables: fbTables,
};
/** Map DB table_ref → UI `table` for KDS. */
export function mapKdsOutgoing(row) {
    const r = row;
    const { tableRef, ...rest } = r;
    return { ...rest, table: tableRef ?? "" };
}
export function mapKdsIncoming(body) {
    const { table, tableRef, ...rest } = body;
    return { ...rest, tableRef: tableRef ?? table };
}
/** Map DB `time_window` ↔ UI `window` (window is a Postgres reserved word). */
export function mapHappyHourOutgoing(row) {
    const r = row;
    const { timeWindow, ...rest } = r;
    return { ...rest, window: timeWindow ?? "" };
}
export function mapHappyHourIncoming(body) {
    const { window: win, timeWindow, ...rest } = body;
    return { ...rest, timeWindow: timeWindow ?? win };
}
//# sourceMappingURL=index.js.map
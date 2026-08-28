import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, } from "../front-office/base.js";
export const fbTables = {
    outlets: "fb_outlets",
    liveTables: "fb_live_tables",
    tableSessions: "fb_table_sessions",
    orders: "fb_orders",
    orderItems: "fb_order_items",
    kotTickets: "fb_kot_tickets",
    kotItems: "fb_kot_items",
    bills: "fb_bills",
    kdsTickets: "fb_kds_tickets",
    cashierShifts: "fb_cashier_shifts",
    reservations: "fb_reservations",
    menuCategories: "fnb_menu_categories",
    menuItems: "fnb_menu_items",
    modifiers: "fb_modifiers",
    ingredients: "fb_ingredients",
    units: "fnb_units",
    taxGroups: "fnb_tax_groups",
    modifierGroups: "fb_modifier_groups",
    outletTypes: "fb_outlet_types",
    wastage: "fb_wastage",
    stockAdjustments: "fb_stock_adjustments",
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
//# sourceMappingURL=index.js.map
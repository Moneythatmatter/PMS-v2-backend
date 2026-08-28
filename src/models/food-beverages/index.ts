import {
  deleteRow,
  getRowById,
  insertRow,
  listRows,
  newCode,
  newId,
  updateRow,
  type FilterMap,
} from "../front-office/base.js";

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
} as const;

export type FbTableName = (typeof fbTables)[keyof typeof fbTables];

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

export type { FilterMap };

/** Map DB table_ref → UI `table` for KDS. */
export function mapKdsOutgoing<T>(row: T): T {
  const r = row as Record<string, unknown>;
  const { tableRef, ...rest } = r;
  return { ...rest, table: tableRef ?? "" } as T;
}

export function mapKdsIncoming(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { table, tableRef, ...rest } = body;
  return { ...rest, tableRef: tableRef ?? table };
}

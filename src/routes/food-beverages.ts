import { Router } from "express";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { getDashboard } from "../controllers/food-beverages/dashboard.js";
import * as liveTables from "../controllers/food-beverages/live-tables.js";
import * as orders from "../controllers/food-beverages/orders.js";
import * as kds from "../controllers/food-beverages/kds.js";
import * as cashier from "../controllers/food-beverages/cashier.js";
import { getReport } from "../controllers/food-beverages/reports.js";
import {
  fbModel,
  mapHappyHourIncoming,
  mapHappyHourOutgoing,
  mapKdsIncoming,
  mapKdsOutgoing,
} from "../models/food-beverages/index.js";

const router = Router();
const outletFilter = (req: { query: Record<string, unknown> }) => ({
  outlet_id: req.query.outletId as string | undefined,
});

// Dashboard
router.get("/dashboard", getDashboard);

// Live tables (ops)
router.get("/live-tables", liveTables.listLiveTables);
router.patch("/live-tables/:id", liveTables.updateLiveTable);
router.put("/live-tables/:id", liveTables.updateLiveTable);
router.post("/live-tables/:id/seat", liveTables.seatTable);
router.post("/live-tables/:id/settle", liveTables.settleTable);
router.post("/live-tables/:id/clean", liveTables.cleanTable);

// Tables master CRUD (same table as live floor map)
mountCrud(
  router,
  "/tables",
  createTableCrud({
    table: fbModel.tables.liveTables,
    idPrefix: "T",
    listFilters: outletFilter,
    orderBy: "table_no",
    mapIncoming: (body) => {
      const copy = { ...body };
      delete copy.qr;
      return copy;
    },
  }),
);

// Orders (ops)
router.get("/orders", orders.listOrders);
router.get("/orders/:id", orders.getOrder);
router.post("/orders", orders.createOrder);
router.put("/orders/:id", orders.updateOrder);
router.patch("/orders/:id", orders.updateOrder);
router.delete("/orders/:id", orders.deleteOrder);
router.post("/orders/:id/advance", orders.advanceOrder);

// KDS (ops)
router.get("/kds", kds.listKds);
router.post("/kds", kds.createKds);
router.put("/kds/:id", kds.updateKds);
router.patch("/kds/:id", kds.updateKds);
router.post("/kds/:id/advance", kds.advanceKds);

// Cashier (ops)
router.get("/cashier-shifts", cashier.listShifts);
router.post("/cashier-shifts", cashier.openShift);
router.patch("/cashier-shifts/:id", cashier.updateShift);
router.put("/cashier-shifts/:id", cashier.updateShift);
router.post("/cashier-shifts/:id/close", cashier.closeShift);

// Outlets
mountCrud(
  router,
  "/outlets",
  createTableCrud({ table: fbModel.tables.outlets, idPrefix: "OUT" }),
);

// Reservations
mountCrud(
  router,
  "/reservations",
  createTableCrud({
    table: fbModel.tables.reservations,
    idPrefix: "RES",
    listFilters: outletFilter,
  }),
);

// Menu
mountCrud(
  router,
  "/menu/categories",
  createTableCrud({ table: fbModel.tables.menuCategories, idPrefix: "MC" }),
);
mountCrud(
  router,
  "/menu/items",
  createTableCrud({
    table: fbModel.tables.menuItems,
    idPrefix: "MI",
    listFilters: outletFilter,
  }),
);
mountCrud(
  router,
  "/menu/modifiers",
  createTableCrud({ table: fbModel.tables.modifiers, idPrefix: "MOD" }),
);
mountCrud(
  router,
  "/menu/combos",
  createTableCrud({ table: fbModel.tables.combos, idPrefix: "CMB" }),
);
mountCrud(
  router,
  "/menu/pricing",
  createTableCrud({
    table: fbModel.tables.pricingRules,
    idPrefix: "PR",
    listFilters: outletFilter,
  }),
);

// Banquet
mountCrud(
  router,
  "/banquet/bookings",
  createTableCrud({ table: fbModel.tables.banquetBookings, idPrefix: "BB" }),
);
mountCrud(
  router,
  "/banquet/packages",
  createTableCrud({ table: fbModel.tables.banquetPackages, idPrefix: "BP" }),
);
mountCrud(
  router,
  "/banquet/requirements",
  createTableCrud({
    table: fbModel.tables.banquetRequirements,
    idPrefix: "BR",
    listFilters: outletFilter,
  }),
);
mountCrud(
  router,
  "/banquet/billing",
  createTableCrud({ table: fbModel.tables.banquetBilling, idPrefix: "BL" }),
);

// Inventory
mountCrud(
  router,
  "/inventory/ingredients",
  createTableCrud({ table: fbModel.tables.ingredients, idPrefix: "ING" }),
);
mountCrud(
  router,
  "/inventory/suppliers",
  createTableCrud({ table: fbModel.tables.suppliers, idPrefix: "SUP" }),
);
mountCrud(
  router,
  "/inventory/purchase-orders",
  createTableCrud({ table: fbModel.tables.purchaseOrders, idPrefix: "PO" }),
);
mountCrud(
  router,
  "/inventory/grn",
  createTableCrud({ table: fbModel.tables.grn, idPrefix: "GRN" }),
);
mountCrud(
  router,
  "/inventory/stock-movements",
  createTableCrud({ table: fbModel.tables.stockMovements, idPrefix: "SM" }),
);
mountCrud(
  router,
  "/inventory/wastage",
  createTableCrud({ table: fbModel.tables.wastage, idPrefix: "WST" }),
);
mountCrud(
  router,
  "/inventory/stock-counts",
  createTableCrud({ table: fbModel.tables.stockCounts, idPrefix: "SC" }),
);
mountCrud(
  router,
  "/inventory/adjustments",
  createTableCrud({ table: fbModel.tables.stockAdjustments, idPrefix: "ADJ" }),
);

// Bar
mountCrud(
  router,
  "/bar/drink-categories",
  createTableCrud({ table: fbModel.tables.drinkCategories, idPrefix: "DC" }),
);
mountCrud(
  router,
  "/bar/drinks",
  createTableCrud({
    table: fbModel.tables.drinks,
    idPrefix: "DR",
    listFilters: outletFilter,
  }),
);
mountCrud(
  router,
  "/bar/cocktails",
  createTableCrud({ table: fbModel.tables.cocktails, idPrefix: "CK" }),
);
mountCrud(
  router,
  "/bar/happy-hour",
  createTableCrud({
    table: fbModel.tables.happyHour,
    idPrefix: "HH",
    listFilters: outletFilter,
    mapIncoming: mapHappyHourIncoming,
    mapOutgoing: mapHappyHourOutgoing,
  }),
);
mountCrud(
  router,
  "/bar/stock",
  createTableCrud({
    table: fbModel.tables.barStock,
    idPrefix: "BS",
    listFilters: outletFilter,
  }),
);
mountCrud(
  router,
  "/bar/bottles",
  createTableCrud({
    table: fbModel.tables.bottleTracking,
    idPrefix: "BT",
    listFilters: outletFilter,
  }),
);

// Settings
mountCrud(
  router,
  "/settings/taxes",
  createTableCrud({ table: fbModel.tables.taxes, idPrefix: "TX" }),
);
mountCrud(
  router,
  "/settings/discounts",
  createTableCrud({ table: fbModel.tables.discounts, idPrefix: "DSC" }),
);
mountCrud(
  router,
  "/settings/payment-modes",
  createTableCrud({ table: fbModel.tables.paymentModes, idPrefix: "PM" }),
);
mountCrud(
  router,
  "/settings/order-types",
  createTableCrud({ table: fbModel.tables.orderTypes, idPrefix: "OT" }),
);

// Day close
mountCrud(
  router,
  "/day-close",
  createTableCrud({
    table: fbModel.tables.dayClosings,
    idPrefix: "DC",
    listFilters: outletFilter,
  }),
);

// Also expose raw KDS CRUD for completeness (list already custom)
mountCrud(
  router,
  "/kds-tickets",
  createTableCrud({
    table: fbModel.tables.kdsTickets,
    idPrefix: "K",
    listFilters: outletFilter,
    mapIncoming: mapKdsIncoming,
    mapOutgoing: mapKdsOutgoing,
  }),
);

// Reports
router.get("/reports/:type", getReport);

export default router;

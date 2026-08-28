import { Router } from "express";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { getDashboard } from "../controllers/food-beverages/dashboard.js";
import * as liveTables from "../controllers/food-beverages/live-tables.js";
import * as floorPlan from "../controllers/food-beverages/floor-plan.js";
import * as pos from "../controllers/food-beverages/pos.js";
import * as orders from "../controllers/food-beverages/orders.js";
import * as kds from "../controllers/food-beverages/kds.js";
import * as cashier from "../controllers/food-beverages/cashier.js";
import { getReport } from "../controllers/food-beverages/reports.js";
import { mountModuleRecords } from "../controllers/food-beverages/module-records.js";
import { fbModel, mapKdsIncoming, mapKdsOutgoing, } from "../models/food-beverages/index.js";
const router = Router();
const outletFilter = (req) => ({
    outlet_id: req.query.outletId,
});
// Dashboard
router.get("/dashboard", getDashboard);
// Live tables (ops)
router.get("/live-tables", liveTables.listLiveTables);
router.get("/floor-plan", floorPlan.listFloorPlan);
router.get("/floor-plan/:id", floorPlan.getFloorPlanTable);
router.patch("/live-tables/:id", liveTables.updateLiveTable);
router.put("/live-tables/:id", liveTables.updateLiveTable);
router.post("/live-tables/:id/seat", liveTables.seatTable);
router.post("/live-tables/:id/settle", liveTables.settleTable);
router.post("/live-tables/:id/clean", liveTables.cleanTable);
// POS v2 — sessions, KOT, bills
router.post("/pos/kot", pos.sendKot);
router.get("/pos/kots", pos.listKots);
router.post("/pos/kots/:kotId/accept", pos.acceptKot);
router.post("/pos/kots/:kotId/reject", pos.rejectKot);
router.post("/pos/kot-items/:kotItemId/cancel", pos.cancelKotItem);
router.post("/pos/kots/:kotId/advance", pos.advanceKot);
router.get("/pos/tables/:tableId/open-order", pos.getOpenTableOrder);
router.get("/pos/orders/:id/details", pos.getOrderDetails);
router.post("/pos/orders/:orderId/print-bill", pos.printBillForOrder);
router.get("/pos/bills", pos.listBills);
router.post("/pos/bills/:billId/print", pos.printBill);
router.post("/pos/bills/:billId/pay", pos.payBill);
// Tables master CRUD (same table as live floor map)
mountCrud(router, "/tables", createTableCrud({
    table: fbModel.tables.liveTables,
    idPrefix: "T",
    listFilters: outletFilter,
    orderBy: "table_no",
}));
// Orders (ops)
router.get("/orders", orders.listOrders);
router.get("/orders/:id", orders.getOrder);
router.post("/orders", orders.createOrder);
router.put("/orders/:id", orders.updateOrder);
router.patch("/orders/:id", orders.updateOrder);
router.delete("/orders/:id", orders.deleteOrder);
router.post("/orders/:id/advance", orders.advanceOrder);
router.post("/orders/:id/accept", orders.acceptOrder);
router.post("/orders/:id/reject", orders.rejectOrder);
router.post("/orders/:id/pay", orders.payOrder);
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
mountCrud(router, "/outlets", createTableCrud({ table: fbModel.tables.outlets, idPrefix: "OUT" }));
// Reservations
mountCrud(router, "/reservations", createTableCrud({
    table: fbModel.tables.reservations,
    idPrefix: "RES",
    listFilters: outletFilter,
}));
function parseBool(value) {
    if (value === true || value === "true" || value === "Active" || value === "Yes")
        return true;
    if (value === false || value === "false" || value === "Inactive" || value === "No")
        return false;
    return undefined;
}
function mapMasterActiveIncoming(body) {
    const b = { ...body };
    const isActive = parseBool(b.isActive ?? b.status);
    if (isActive !== undefined)
        b.isActive = isActive;
    delete b.status;
    return b;
}
function mapMasterActiveOutgoing(row) {
    if (row && typeof row === "object") {
        const r = row;
        r.status = r.isActive === false ? "Inactive" : "Active";
    }
    return row;
}
// Masters
mountCrud(router, "/masters/units", createTableCrud({
    table: fbModel.tables.units,
    idPrefix: "UN",
    mapIncoming: mapMasterActiveIncoming,
    mapOutgoing: mapMasterActiveOutgoing,
}));
mountCrud(router, "/masters/tax-groups", createTableCrud({
    table: fbModel.tables.taxGroups,
    idPrefix: "TG",
    mapIncoming: mapMasterActiveIncoming,
    mapOutgoing: mapMasterActiveOutgoing,
}));
mountCrud(router, "/masters/modifier-groups", createTableCrud({ table: fbModel.tables.modifierGroups, idPrefix: "MGR" }));
mountCrud(router, "/masters/outlet-types", createTableCrud({ table: fbModel.tables.outletTypes, idPrefix: "OFT" }));
// Menu
function mapCategoryIncoming(body) {
    const b = mapMasterActiveIncoming(body);
    if (b.parentId === "" || b.parentId === null)
        delete b.parentId;
    return b;
}
function mapCategoryOutgoing(row) {
    return mapMasterActiveOutgoing(row);
}
function mapMenuItemIncoming(body) {
    const b = { ...body };
    if (b.code !== undefined && b.itemCode === undefined) {
        b.itemCode = b.code;
        delete b.code;
    }
    const isActive = parseBool(b.isActive);
    if (isActive !== undefined)
        b.isActive = isActive;
    const isVegetarian = parseBool(b.isVegetarian);
    if (isVegetarian !== undefined)
        b.isVegetarian = isVegetarian;
    if (b.price !== undefined && b.price !== null && b.price !== "") {
        const raw = String(b.price).replace(/₹/g, "").replace(/,/g, "").trim();
        const num = Number(raw);
        if (Number.isFinite(num))
            b.price = num;
    }
    for (const key of ["categoryId", "taxGroupId", "imageUrl"]) {
        if (b[key] === "")
            delete b[key];
    }
    delete b.unitId;
    delete b.stationId;
    delete b.itemType;
    delete b.status;
    delete b.category;
    delete b.cost;
    return b;
}
function mapMenuItemOutgoing(row) {
    if (row && typeof row === "object") {
        const r = row;
        r.status = r.isActive === false ? "Inactive" : "Active";
        if (r.itemCode !== undefined)
            r.code = r.itemCode;
    }
    return row;
}
mountCrud(router, "/menu/categories", createTableCrud({
    table: fbModel.tables.menuCategories,
    idPrefix: "MC",
    orderBy: "display_order",
    mapIncoming: mapCategoryIncoming,
    mapOutgoing: mapCategoryOutgoing,
}));
mountCrud(router, "/menu/items", createTableCrud({
    table: fbModel.tables.menuItems,
    idPrefix: "MI",
    orderBy: "display_order",
    mapIncoming: mapMenuItemIncoming,
    mapOutgoing: mapMenuItemOutgoing,
}));
mountCrud(router, "/menu/modifiers", createTableCrud({ table: fbModel.tables.modifiers, idPrefix: "MOD" }));
// Inventory
mountCrud(router, "/inventory/ingredients", createTableCrud({ table: fbModel.tables.ingredients, idPrefix: "ING" }));
mountCrud(router, "/inventory/wastage", createTableCrud({ table: fbModel.tables.wastage, idPrefix: "WST" }));
mountCrud(router, "/inventory/adjustments", createTableCrud({ table: fbModel.tables.stockAdjustments, idPrefix: "ADJ" }));
// Day close
mountCrud(router, "/day-close", createTableCrud({
    table: fbModel.tables.dayClosings,
    idPrefix: "DC",
    listFilters: outletFilter,
}));
// Also expose raw KDS CRUD for completeness (list already custom)
mountCrud(router, "/kds-tickets", createTableCrud({
    table: fbModel.tables.kdsTickets,
    idPrefix: "K",
    listFilters: outletFilter,
    mapIncoming: mapKdsIncoming,
    mapOutgoing: mapKdsOutgoing,
}));
// Reports
router.get("/reports/:type", getReport);
// Flexible module records (pages without dedicated tables)
mountModuleRecords(router, "/menu/recipes", "menu/recipes", "RC");
export default router;
//# sourceMappingURL=food-beverages.js.map
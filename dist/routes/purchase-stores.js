import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { requireModule } from "../middleware/module-access.js";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import * as dashboard from "../controllers/purchase-stores/dashboard.js";
import * as receiving from "../controllers/purchase-stores/receiving.js";
import * as openingStock from "../controllers/purchase-stores/opening-stock.js";
import * as prLifecycle from "../controllers/purchase-stores/requisition-lifecycle.js";
import { psModel } from "../models/purchase-stores/index.js";
import { withPsDocumentDefaults } from "../utils/purchase-stores-docs.js";
const router = Router();
const T = psModel.tables;
router.use(requireAuth);
router.use(requireProperty);
router.use(requireModule("purchase_stores", [
    {
        methods: ["GET"],
        path: /^\/(masters\/(categories|products|units)|warehouses|stock-balances)(\/|$)/,
        modules: "any",
    },
    { methods: "*", path: /^\/requisitions(\/|$)/, modules: "any" },
]));
const docCrud = (table, idPrefix, docDefaults, statusKey = "status") => createTableCrud({
    table,
    idPrefix,
    mapIncoming: docDefaults
        ? (body, ctx) => (ctx?.isCreate ? withPsDocumentDefaults(body, docDefaults) : body)
        : undefined,
    listFilters: (req) => {
        const filters = {};
        const status = req.query.status;
        const department = req.query.department;
        if (status && status !== "all")
            filters[statusKey] = status;
        if (department && department !== "all")
            filters.department = department;
        return filters;
    },
    orderBy: "created_at",
    ascending: false,
});
// Dashboard & special queries
router.get("/dashboard", dashboard.getDashboard);
router.get("/stock-ledger", dashboard.listStockLedger);
router.get("/grns/by-po/:poNumber", dashboard.listGrnsByPo);
// Masters
mountCrud(router, "/masters/units", createTableCrud({ table: T.units, idPrefix: "PSU", orderBy: "unit_code" }));
mountCrud(router, "/masters/categories", createTableCrud({ table: T.categories, idPrefix: "PSC", orderBy: "category_code" }));
mountCrud(router, "/masters/suppliers", createTableCrud({ table: T.suppliers, idPrefix: "PSS", orderBy: "supplier_code" }));
mountCrud(router, "/masters/products", createTableCrud({
    table: T.products,
    idPrefix: "PSP",
    listFilters: (req) => ({
        status: req.query.status !== "all" ? req.query.status : undefined,
        category: req.query.category !== "all" ? req.query.category : undefined,
    }),
    orderBy: "product_code",
}));
mountCrud(router, "/warehouses", createTableCrud({ table: T.warehouses, idPrefix: "PSW", orderBy: "code" }));
// Procurement — one requisition register for every module (header + line items).
// PR status (In Sourcing / Partially Ordered / Closed) is derived from linked RFQs and POs.
router.get("/requisitions/fulfillment", prLifecycle.listFulfillment);
router.post("/requisitions/reconcile", prLifecycle.reconcileStatuses);
router.get("/requisitions/:id/fulfillment", prLifecycle.getFulfillment);
router.get("/requisitions", prLifecycle.listRequisitions);
router.get("/requisitions/:id", prLifecycle.getRequisition);
router.post("/requisitions", prLifecycle.createRequisition);
router.put("/requisitions/:id", prLifecycle.updateRequisition);
router.patch("/requisitions/:id", prLifecycle.updateRequisition);
router.delete("/requisitions/:id", prLifecycle.deleteRequisition);
const rfqCrud = docCrud(T.rfqs, "RFQ", prLifecycle.RFQ_DOC);
router.get("/rfqs", rfqCrud.list);
router.get("/rfqs/:id", rfqCrud.get);
router.post("/rfqs", prLifecycle.createRfq);
router.put("/rfqs/:id", prLifecycle.updateRfq);
router.patch("/rfqs/:id", prLifecycle.updateRfq);
router.delete("/rfqs/:id", prLifecycle.deleteRfq);
const poCrud = docCrud(T.purchaseOrders, "PO", prLifecycle.PO_DOC);
router.get("/purchase-orders", poCrud.list);
router.get("/purchase-orders/:id", poCrud.get);
router.post("/purchase-orders", prLifecycle.createPurchaseOrder);
router.put("/purchase-orders/:id", prLifecycle.updatePurchaseOrder);
router.patch("/purchase-orders/:id", prLifecycle.updatePurchaseOrder);
router.delete("/purchase-orders/:id", prLifecycle.deletePurchaseOrder);
mountCrud(router, "/direct-purchases", docCrud(T.dsp, "DSP", { numberField: "dspNumber", prefix: "DSP", dateDefaults: { purchaseDate: "today", receivingDate: "today" } }));
mountCrud(router, "/contracts", docCrud(T.contracts, "RC", { numberField: "contractNumber", prefix: "RC" }));
mountCrud(router, "/invoices", docCrud(T.invoices, "INV", { numberField: "invoiceNumber", prefix: "INV", dateDefaults: { invoiceDate: "today" } }));
// Receiving — GRN create auto-spawns QC; QC complete posts stock
const grnCrud = docCrud(T.grns, "GRN", {
    numberField: "grnNumber",
    prefix: "GRN",
    dateDefaults: { receiptDate: "today" },
});
router.get("/grns", grnCrud.list);
router.get("/grns/:id", grnCrud.get);
router.post("/grns", receiving.createGrn);
router.put("/grns/:id", grnCrud.update);
router.patch("/grns/:id", grnCrud.update);
router.delete("/grns/:id", grnCrud.remove);
const qiCrud = docCrud(T.qualityInspections, "QI", {
    numberField: "inspectionNumber",
    prefix: "QI",
    dateDefaults: { inspectionDate: "today" },
});
router.get("/quality-inspections", qiCrud.list);
router.get("/quality-inspections/:id", qiCrud.get);
router.post("/quality-inspections", qiCrud.create);
router.put("/quality-inspections/:id", receiving.updateQualityInspection);
router.patch("/quality-inspections/:id", receiving.updateQualityInspection);
router.delete("/quality-inspections/:id", qiCrud.remove);
mountCrud(router, "/vendor-returns", docCrud(T.vendorReturns, "VR", { numberField: "returnNumber", prefix: "VR", dateDefaults: { returnDate: "today" } }));
// Inventory
router.post("/stock-balances/opening", openingStock.postOpeningStock);
mountCrud(router, "/stock-balances", createTableCrud({
    table: T.stockBalances,
    idPrefix: "SB",
    listFilters: (req) => ({
        material_id: req.query.materialId,
        warehouse_id: req.query.warehouseId,
        status: req.query.status !== "all" ? req.query.status : undefined,
    }),
}));
mountCrud(router, "/stock-issues", docCrud(T.stockIssues, "ISS", { numberField: "issueNo", prefix: "ISS" }));
mountCrud(router, "/stock-transfers", docCrud(T.stockTransfers, "TRF", { numberField: "transferNo", prefix: "TRF" }));
mountCrud(router, "/stock-adjustments", docCrud(T.stockAdjustments, "ADJ", { numberField: "adjustmentNo", prefix: "ADJ", dateDefaults: { adjustmentDate: "today" } }));
mountCrud(router, "/par-stock", createTableCrud({ table: T.parStock, idPrefix: "PAR" }));
mountCrud(router, "/batches", createTableCrud({
    table: T.batches,
    idPrefix: "BAT",
    listFilters: (req) => ({
        status: req.query.status !== "all" ? req.query.status : undefined,
        warehouse: req.query.warehouse !== "all" ? req.query.warehouse : undefined,
    }),
}));
export default router;
//# sourceMappingURL=purchase-stores.js.map
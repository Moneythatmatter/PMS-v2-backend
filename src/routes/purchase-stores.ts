import { Router } from "express";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import * as dashboard from "../controllers/purchase-stores/dashboard.js";
import * as receiving from "../controllers/purchase-stores/receiving.js";
import { psModel } from "../models/purchase-stores/index.js";
import { withPsDocumentDefaults } from "../utils/purchase-stores-docs.js";

const router = Router();
const T = psModel.tables;

const docCrud = (
  table: string,
  idPrefix: string,
  docDefaults?: { numberField: string; prefix: string; dateDefaults?: Record<string, string> },
  statusKey = "status",
) =>
  createTableCrud({
    table,
    idPrefix,
    mapIncoming: docDefaults
      ? (body, ctx) => (ctx?.isCreate ? withPsDocumentDefaults(body, docDefaults) : body)
      : undefined,
    listFilters: (req) => {
      const filters: Record<string, string | undefined> = {};
      const status = req.query.status as string | undefined;
      const department = req.query.department as string | undefined;
      if (status && status !== "all") filters[statusKey] = status;
      if (department && department !== "all") filters.department = department;
      return filters;
    },
    orderBy: "created_at",
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
    status: req.query.status !== "all" ? (req.query.status as string) : undefined,
    category: req.query.category !== "all" ? (req.query.category as string) : undefined,
  }),
  orderBy: "product_code",
}));
mountCrud(router, "/warehouses", createTableCrud({ table: T.warehouses, idPrefix: "PSW", orderBy: "code" }));

// Procurement
mountCrud(
  router,
  "/requisitions",
  docCrud(T.purchaseRequisitions, "PR", {
    numberField: "prNumber",
    prefix: "PR",
    dateDefaults: { requestDate: "today", requiredDate: "today" },
  }),
);
mountCrud(
  router,
  "/rfqs",
  docCrud(T.rfqs, "RFQ", {
    numberField: "rfqNumber",
    prefix: "RFQ",
    dateDefaults: { rfqDate: "today", closingDate: "today" },
  }),
);
mountCrud(
  router,
  "/purchase-orders",
  docCrud(T.purchaseOrders, "PO", { numberField: "poNumber", prefix: "PO", dateDefaults: { orderDate: "today" } }),
);
mountCrud(
  router,
  "/direct-purchases",
  docCrud(T.dsp, "DSP", { numberField: "dspNumber", prefix: "DSP", dateDefaults: { purchaseDate: "today", receivingDate: "today" } }),
);
mountCrud(
  router,
  "/contracts",
  docCrud(T.contracts, "RC", { numberField: "contractNumber", prefix: "RC" }),
);
mountCrud(
  router,
  "/invoices",
  docCrud(T.invoices, "INV", { numberField: "invoiceNumber", prefix: "INV", dateDefaults: { invoiceDate: "today" } }),
);

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
mountCrud(
  router,
  "/vendor-returns",
  docCrud(T.vendorReturns, "VR", { numberField: "returnNumber", prefix: "VR", dateDefaults: { returnDate: "today" } }),
);

// Inventory
mountCrud(router, "/stock-balances", createTableCrud({
  table: T.stockBalances,
  idPrefix: "SB",
  listFilters: (req) => ({
    material_id: req.query.materialId as string | undefined,
    warehouse_id: req.query.warehouseId as string | undefined,
    status: req.query.status !== "all" ? (req.query.status as string) : undefined,
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
    status: req.query.status !== "all" ? (req.query.status as string) : undefined,
    warehouse: req.query.warehouse !== "all" ? (req.query.warehouse as string) : undefined,
  }),
}));

export default router;

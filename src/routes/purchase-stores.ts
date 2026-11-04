import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { requireModule } from "../middleware/module-access.js";
import { attachRequestContext } from "../middleware/request-context.js";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import * as dashboard from "../controllers/purchase-stores/dashboard.js";
import * as receiving from "../controllers/purchase-stores/receiving.js";
import * as openingStock from "../controllers/purchase-stores/opening-stock.js";
import * as prLifecycle from "../controllers/purchase-stores/requisition-lifecycle.js";
import { psModel } from "../models/purchase-stores/index.js";
import { withPsDocumentDefaults } from "../utils/purchase-stores-docs.js";
import { fromError, ok } from "../utils/response.js";
import {
  attachSupplierPartyData,
  listSupplierPartyOptions,
  prepareSupplierCreate,
  prepareSupplierUpdate,
} from "../services/shared/vendor-party.service.js";
import {
  assertAdjustmentDeletable,
  prepareAdjustmentCreate,
  prepareAdjustmentUpdate,
} from "../services/purchase-stores/stock-adjustment.service.js";
import {
  assertIssueDeletable,
  assertTransferDeletable,
  prepareIssueCreate,
  prepareIssueUpdate,
  prepareTransferCreate,
  prepareTransferUpdate,
} from "../services/purchase-stores/stock-movement.service.js";

const router = Router();
const T = psModel.tables;

router.use(requireAuth);
router.use(requireProperty);
router.use(
  requireModule("purchase_stores", [
    {
      methods: ["GET"],
      path: /^\/(masters\/(categories|products|units)|warehouses|stock-balances)(\/|$)/,
      modules: "any",
    },
    { methods: "*", path: /^\/requisitions(\/|$)/, modules: "any" },
  ]),
);
router.use(attachRequestContext);

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
    ascending: false,
  });

// Dashboard & special queries
router.get("/dashboard", dashboard.getDashboard);
router.get("/stock-ledger", dashboard.listStockLedger);
router.get("/grns/by-po/:poNumber", dashboard.listGrnsByPo);

// Masters
mountCrud(router, "/masters/units", createTableCrud({ table: T.units, idPrefix: "PSU", orderBy: "unit_code" }));
mountCrud(router, "/masters/categories", createTableCrud({ table: T.categories, idPrefix: "PSC", orderBy: "category_code" }));
router.get("/masters/suppliers/party-options", async (_req, res) => {
  try {
    return ok(res, await listSupplierPartyOptions());
  } catch (e) {
    return fromError(res, e);
  }
});
mountCrud(router, "/masters/suppliers", createTableCrud({
  table: T.suppliers,
  idPrefix: "PSS",
  orderBy: "supplier_code",
  beforeCreate: prepareSupplierCreate,
  beforeUpdate: prepareSupplierUpdate,
  afterRead: attachSupplierPartyData,
}));
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
const updateGrnKeepingPo: typeof grnCrud.update = (req, res) => {
  if (req.body && typeof req.body === "object") delete (req.body as Record<string, unknown>).poNumber;
  return grnCrud.update(req, res);
};
router.put("/grns/:id", updateGrnKeepingPo);
router.patch("/grns/:id", updateGrnKeepingPo);
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
router.post("/stock-balances/opening", openingStock.postOpeningStock);
mountCrud(router, "/stock-balances", createTableCrud({
  table: T.stockBalances,
  idPrefix: "SB",
  listFilters: (req) => ({
    material_id: req.query.materialId as string | undefined,
    warehouse_id: req.query.warehouseId as string | undefined,
    status: req.query.status !== "all" ? (req.query.status as string) : undefined,
  }),
}));
const mountGuardedDoc = (
  path: string,
  table: string,
  doc: { numberField: string; prefix: string; dateDefaults?: Record<string, string> },
  hooks: {
    beforeCreate: (body: Record<string, unknown>) => Promise<void>;
    beforeUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
    beforeDelete: (id: string) => Promise<void>;
  },
) => {
  const crud = createTableCrud({
    table,
    idPrefix: doc.prefix,
    mapIncoming: (body, ctx) => (ctx?.isCreate ? withPsDocumentDefaults(body, doc) : body),
    listFilters: (req) => ({ status: req.query.status && req.query.status !== "all" ? String(req.query.status) : undefined }),
    orderBy: "created_at",
    ascending: false,
    beforeCreate: hooks.beforeCreate,
    beforeUpdate: hooks.beforeUpdate,
  });
  router.get(path, crud.list);
  router.get(`${path}/:id`, crud.get);
  router.post(path, crud.create);
  router.put(`${path}/:id`, crud.update);
  router.patch(`${path}/:id`, crud.update);
  router.delete(`${path}/:id`, async (req, res) => {
    try {
      await hooks.beforeDelete(String(req.params.id));
      return crud.remove(req, res);
    } catch (e) {
      return fromError(res, e);
    }
  });
};

// Stock movements post to balances + ledger on approval (server-side, idempotent per document).
mountGuardedDoc("/stock-issues", T.stockIssues, { numberField: "issueNo", prefix: "ISS" }, {
  beforeCreate: prepareIssueCreate,
  beforeUpdate: prepareIssueUpdate,
  beforeDelete: assertIssueDeletable,
});
mountGuardedDoc("/stock-transfers", T.stockTransfers, { numberField: "transferNo", prefix: "TRF" }, {
  beforeCreate: prepareTransferCreate,
  beforeUpdate: prepareTransferUpdate,
  beforeDelete: assertTransferDeletable,
});
mountGuardedDoc("/stock-adjustments", T.stockAdjustments, { numberField: "adjustmentNo", prefix: "ADJ", dateDefaults: { adjustmentDate: "today" } }, {
  beforeCreate: prepareAdjustmentCreate,
  beforeUpdate: prepareAdjustmentUpdate,
  beforeDelete: assertAdjustmentDeletable,
});
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

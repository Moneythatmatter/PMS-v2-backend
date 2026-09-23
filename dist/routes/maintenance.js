import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { attachRequestContext } from "../middleware/request-context.js";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import * as dashboard from "../controllers/maintenance/dashboard.js";
import { mntModel } from "../models/maintenance/index.js";
import { packMntDocument, unpackMntDocument, withMntDocumentDefaults, } from "../utils/maintenance-docs.js";
const router = Router();
router.use(requireAuth);
router.use(requireProperty);
router.use(attachRequestContext);
const T = mntModel.tables;
const masterCrud = (table, idPrefix, orderBy) => createTableCrud({
    table,
    idPrefix,
    orderBy,
    listFilters: (req) => ({
        status: req.query.status !== "all" ? req.query.status : undefined,
    }),
});
const docCrud = (cfg) => createTableCrud({
    table: cfg.table,
    idPrefix: cfg.idPrefix,
    orderBy: cfg.orderBy ?? "created_at",
    mapIncoming: (body, ctx) => {
        let next = { ...body };
        if (ctx?.isCreate) {
            next = withMntDocumentDefaults(next, {
                numberField: cfg.numberField,
                prefix: cfg.prefix,
                dateDefaults: cfg.dateDefaults,
            });
        }
        return packMntDocument(next, { filterKeys: cfg.filterKeys });
    },
    mapOutgoing: (row) => unpackMntDocument(row),
    listFilters: (req) => {
        const filters = {};
        const status = req.query.status;
        if (status && status !== "all")
            filters.status = status;
        return filters;
    },
});
router.get("/dashboard", dashboard.getDashboard);
router.get("/reports", dashboard.getReports);
// Masters
mountCrud(router, "/masters/asset-categories", masterCrud(T.assetCategories, "MAC", "category_code"));
mountCrud(router, "/masters/problem-categories", masterCrud(T.problemCategories, "MPC", "category_code"));
mountCrud(router, "/masters/root-causes", masterCrud(T.rootCauses, "MRC", "root_cause_code"));
mountCrud(router, "/masters/pm-templates", masterCrud(T.pmTemplates, "MPT", "template_code"));
mountCrud(router, "/masters/vendors", masterCrud(T.vendors, "MNV", "vendor_code"));
mountCrud(router, "/masters/spare-parts", masterCrud(T.spareParts, "MSP", "part_code"));
// Operations
mountCrud(router, "/assets", docCrud({
    table: T.assets,
    idPrefix: "AST",
    numberField: "assetCode",
    prefix: "AST",
    filterKeys: ["assetCode", "assetName", "category", "locationType", "location", "status"],
    orderBy: "asset_code",
}));
mountCrud(router, "/requests", docCrud({
    table: T.requests,
    idPrefix: "MREQ",
    numberField: "requestNo",
    prefix: "REQ",
    filterKeys: [
        "requestNo",
        "dateTime",
        "locationType",
        "location",
        "category",
        "issueTitle",
        "priority",
        "status",
        "workOrderNo",
    ],
    orderBy: "created_at",
}));
mountCrud(router, "/work-orders", docCrud({
    table: T.workOrders,
    idPrefix: "MWO",
    numberField: "woNumber",
    prefix: "WO",
    filterKeys: [
        "woNumber",
        "requestRef",
        "woType",
        "location",
        "locationType",
        "roomBlockType",
        "problemCategory",
        "priority",
        "status",
        "dueDate",
    ],
    dateDefaults: { dueDate: "today" },
    orderBy: "created_at",
}));
mountCrud(router, "/pm-schedules", docCrud({
    table: T.pmSchedules,
    idPrefix: "MPM",
    numberField: "pmNumber",
    prefix: "PM",
    filterKeys: [
        "pmNumber",
        "assetCode",
        "assetName",
        "category",
        "location",
        "taskTitle",
        "frequency",
        "nextDueDate",
        "status",
    ],
    dateDefaults: { nextDueDate: "today", firstDueDate: "today" },
    orderBy: "next_due_date",
}));
export default router;
//# sourceMappingURL=maintenance.js.map
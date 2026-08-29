import { listRows } from "../../models/front-office/base.js";
import { psTables } from "../../models/purchase-stores/index.js";
import { fromError, ok } from "../../utils/response.js";
export async function getDashboard(_req, res) {
    try {
        const [requisitions, orders, dsp, invoices, contracts, products, suppliers, balances,] = await Promise.all([
            listRows(psTables.purchaseRequisitions),
            listRows(psTables.purchaseOrders),
            listRows(psTables.dsp),
            listRows(psTables.invoices),
            listRows(psTables.contracts),
            listRows(psTables.products),
            listRows(psTables.suppliers),
            listRows(psTables.stockBalances),
        ]);
        const pendingPrs = requisitions.filter((r) => r.status === "Pending Approval");
        const pendingPos = orders.filter((o) => o.status === "Pending Approval");
        const pendingInvoices = invoices.filter((i) => i.status === "Pending Verification");
        const activeContracts = contracts.filter((c) => c.status === "Active");
        const lowStock = products.filter((p) => (p.parStock ?? 0) - 20 < (p.reorderLevel ?? 0));
        return ok(res, {
            counts: {
                requisitions: requisitions.length,
                pendingRequisitions: pendingPrs.length,
                purchaseOrders: orders.length,
                pendingPurchaseOrders: pendingPos.length,
                dsp: dsp.length,
                pendingDsp: dsp.filter((d) => d.status === "Pending Approval").length,
                invoices: invoices.length,
                pendingInvoices: pendingInvoices.length,
                contracts: contracts.length,
                activeContracts: activeContracts.length,
                products: products.length,
                suppliers: suppliers.length,
                stockBalances: balances.length,
                lowStockSkus: lowStock.length,
            },
            recentRequisitions: requisitions.slice(0, 6),
            recentDsp: dsp.slice(0, 4),
            lowStockItems: lowStock.slice(0, 5),
            stockPreview: products.slice(0, 5),
        });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listStockLedger(req, res) {
    try {
        const materialId = req.query.materialId;
        const warehouseId = req.query.warehouseId;
        const filters = {};
        if (materialId)
            filters.material_id = materialId;
        if (warehouseId)
            filters.warehouse_id = warehouseId;
        const rows = await listRows(psTables.stockLedger, {
            filters,
            orderBy: "transaction_date",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listGrnsByPo(req, res) {
    try {
        const poNumber = String(req.params.poNumber);
        const rows = await listRows(psTables.grns, {
            filters: { po_number: poNumber },
            orderBy: "receipt_date",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=dashboard.js.map
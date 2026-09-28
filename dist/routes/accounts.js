import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { attachRequestContext } from "../middleware/request-context.js";
import { accountTree, auditLogs, bankRecon, billHandlers, closingStockPost, coveringLetterHandlers, fiscalYearActions, getCompanySettings, lookups, masterHandlers, periods, reportHandlers, updateCompanySettings, voucherHandlers, } from "../controllers/accounts/index.js";
const router = Router();
router.use(requireAuth);
router.use(requireProperty);
router.use(attachRequestContext);
router.get("/dashboard", reportHandlers.dashboard);
router.get("/lookups", lookups);
router.get("/audit-logs", auditLogs);
// Masters -------------------------------------------------------------------
router.get("/masters/accounts/tree", accountTree);
router.get("/masters/company-settings", getCompanySettings);
router.put("/masters/company-settings/:id", updateCompanySettings);
router.patch("/masters/company-settings/:id", updateCompanySettings);
router.post("/masters/fiscal-years/:id/open", fiscalYearActions.open);
router.post("/masters/fiscal-years/:id/set-current", fiscalYearActions.setCurrent);
router.post("/masters/fiscal-years/:id/close", fiscalYearActions.close);
router.post("/masters/fiscal-years/:id/reopen", fiscalYearActions.reopen);
const masterRoutes = [
    ["/masters/currencies", "currencies"],
    ["/masters/companies", "companies"],
    ["/masters/accounts", "accounts"],
    ["/masters/divisions", "divisions"],
    ["/masters/party-types", "partyTypes"],
    ["/masters/party-sub-types", "partySubTypes"],
    ["/masters/payment-methods", "paymentMethods"],
    ["/masters/parties", "parties"],
    ["/masters/voucher-types", "voucherTypes"],
    ["/masters/revenue-categories", "revenueCategories"],
    ["/masters/tax-definitions", "taxDefinitions"],
    ["/masters/tax-rules", "taxRules"],
    ["/masters/budgets", "budgets"],
    ["/masters/fiscal-years", "fiscalYears"],
    ["/closing-stock", "closingStock"],
];
router.post("/closing-stock/post", closingStockPost);
for (const [path, key] of masterRoutes) {
    const h = masterHandlers(key);
    router.get(path, h.list);
    router.get(`${path}/:id`, h.get);
    router.post(path, h.create);
    router.put(`${path}/:id`, h.update);
    router.patch(`${path}/:id`, h.update);
    router.delete(`${path}/:id`, h.remove);
}
// Fiscal periods ------------------------------------------------------------
router.get("/fiscal-periods", periods.list);
router.post("/fiscal-periods/:id/close", periods.close);
router.post("/fiscal-periods/:id/reopen", periods.reopen);
// Vouchers ------------------------------------------------------------------
router.get("/vouchers", voucherHandlers.list);
router.get("/vouchers/next-number", voucherHandlers.nextNumber);
router.get("/vouchers/:id", voucherHandlers.get);
router.post("/vouchers", voucherHandlers.create);
router.put("/vouchers/:id", voucherHandlers.update);
router.delete("/vouchers/:id", voucherHandlers.remove);
router.post("/vouchers/:id/post", voucherHandlers.post);
router.post("/vouchers/:id/reverse", voucherHandlers.reverse);
router.post("/vouchers/:id/convert", voucherHandlers.convert);
router.post("/vouchers/:id/print", voucherHandlers.print);
router.post("/receipts-payments", voucherHandlers.receiptPayment);
// Bank reconciliation -------------------------------------------------------
router.get("/bank-reconciliation", bankRecon.get);
router.post("/bank-reconciliation/reconcile", bankRecon.reconcile);
router.post("/bank-reconciliation/unreconcile", bankRecon.unreconcile);
// Party bills & covering letters -----------------------------------------------
router.get("/party-bills", billHandlers.list);
router.get("/party-bills/:id", billHandlers.get);
router.post("/party-bills", billHandlers.create);
router.put("/party-bills/:id", billHandlers.update);
router.post("/party-bills/:id/cancel", billHandlers.cancel);
router.post("/party-bills/:id/settle", billHandlers.settle);
router.delete("/bill-settlements/:id", billHandlers.removeSettlement);
router.get("/covering-letters", coveringLetterHandlers.list);
router.get("/covering-letters/candidates", coveringLetterHandlers.candidates);
router.post("/covering-letters", coveringLetterHandlers.create);
router.post("/covering-letters/:id/reverse", coveringLetterHandlers.reverse);
// Reports -------------------------------------------------------------------
router.get("/reports/trial-balance", reportHandlers.trialBalance);
router.get("/reports/profit-loss", reportHandlers.profitLoss);
router.get("/reports/balance-sheet", reportHandlers.balanceSheet);
router.get("/reports/general-ledger", reportHandlers.generalLedger);
router.get("/reports/day-book", reportHandlers.dayBook);
router.get("/reports/outstanding-bills", reportHandlers.outstandingBills);
router.get("/reports/aging-summary", reportHandlers.agingSummary);
router.get("/reports/party-settlement", reportHandlers.partySettlement);
router.get("/reports/reminder-letters", reportHandlers.reminderLetters);
router.get("/reports/balance-confirmation", reportHandlers.balanceConfirmation);
router.get("/reports/payment-advice", reportHandlers.paymentAdvice);
router.get("/reports/analysis", reportHandlers.analysis);
export default router;
//# sourceMappingURL=accounts.js.map
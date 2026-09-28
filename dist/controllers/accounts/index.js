import { fromError, ok } from "../../utils/response.js";
import { accTables, actorName, cleanPayload, insert, isIsoDate, isUuid, list, mustGet, update, } from "../../models/accounts/repo.js";
import { ValidationError } from "../../errors/index.js";
import { createMaster, deleteMaster, getMaster, listMaster, masters, updateMaster, } from "../../services/accounts/masters.service.js";
import * as fiscal from "../../services/accounts/fiscal.service.js";
import * as vouchers from "../../services/accounts/vouchers.service.js";
import * as bills from "../../services/accounts/bills.service.js";
import * as reports from "../../services/accounts/reports.service.js";
import { buildTree, loadAccounts, loadLines, sumByAccount } from "../../services/accounts/ledger.service.js";
/** Wrap a service call: 200 with data, or mapped error response. */
export function handle(fn, status = 200) {
    return async (req, res) => {
        try {
            return ok(res, await fn(req), status);
        }
        catch (e) {
            return fromError(res, e);
        }
    };
}
const q = (req) => req.query;
const body = (req) => (req.body ?? {});
const id = (req) => String(req.params.id);
export function masterHandlers(key) {
    const cfg = masters[key];
    return {
        list: handle((req) => listMaster(cfg, q(req))),
        get: handle((req) => getMaster(cfg, id(req))),
        create: handle((req) => createMaster(cfg, body(req)), 201),
        update: handle((req) => updateMaster(cfg, id(req), body(req))),
        remove: handle((req) => deleteMaster(cfg, id(req))),
    };
}
// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------
const SETTINGS_COLUMNS = [
    "currentFiscalYearId", "accountingMethod", "decimalPlaces", "allowFutureTransactions", "allowBackDatedPosting",
    "backDatedLimitDays", "lockDateBefore", "requireVoucherApproval", "autoVoucherNumbering", "voucherResetFrequency",
    "allowManualVoucherNo", "preventDuplicateVouchers", "requirePostingApproval", "allowNegativeCash",
    "enforceCreditLimit", "defaultReceivableAccountId", "defaultPayableAccountId", "defaultRoundOffAccountId",
    "defaultGuestDepositAccountId", "enableGst", "enableEinvoice", "defaultTaxRegion", "enableTdsDeductions",
];
export const getCompanySettings = handle(async (req) => {
    let companyId = isUuid(q(req).companyId) ? q(req).companyId : undefined;
    if (!companyId) {
        const companies = await list(accTables.companies, { order: [{ column: "created_at" }], limit: 1 });
        companyId = companies[0]?.id;
    }
    if (!companyId)
        throw new ValidationError("Create a company first");
    const company = await mustGet(accTables.companies, companyId, "Company");
    let rows = await list(accTables.companySettings, { eq: { company_id: companyId } });
    if (!rows[0])
        rows = [await insert(accTables.companySettings, { companyId, configuredBy: await actorName() })];
    return { ...rows[0], companyName: company.tradeName, companyCode: company.companyCode };
});
export const updateCompanySettings = handle(async (req) => {
    const payload = cleanPayload(body(req), SETTINGS_COLUMNS);
    if (payload.backDatedLimitDays !== undefined && Number(payload.backDatedLimitDays) < 0) {
        throw new ValidationError("Back-dated limit cannot be negative");
    }
    if (payload.decimalPlaces !== undefined && ![0, 2, 3, 4].includes(Number(payload.decimalPlaces))) {
        throw new ValidationError("Decimal places must be 0, 2, 3 or 4");
    }
    if (payload.lockDateBefore !== undefined && payload.lockDateBefore !== null && !isIsoDate(payload.lockDateBefore)) {
        throw new ValidationError("Lock date must be YYYY-MM-DD");
    }
    const row = await update(accTables.companySettings, id(req), {
        ...payload,
        configuredBy: await actorName(),
        lastAuditDate: new Date().toISOString(),
    });
    if (payload.currentFiscalYearId)
        await fiscal.setCurrentFiscalYear(payload.currentFiscalYearId).catch(() => undefined);
    return row;
});
// ---------------------------------------------------------------------------
// Lookups & COA tree
// ---------------------------------------------------------------------------
export const lookups = handle(async () => {
    const [accounts, parties, divisions, voucherTypes, paymentMethods, currencies, fiscalYears, partyTypes, partySubTypes, companies, taxes, revenueCategories] = await Promise.all([
        list(accTables.accounts, { order: [{ column: "code" }] }),
        list(accTables.parties, { order: [{ column: "party_name" }] }),
        list(accTables.divisions, { order: [{ column: "sequence" }] }),
        list(accTables.voucherTypes, { order: [{ column: "sequence" }] }),
        list(accTables.paymentMethods, { order: [{ column: "payment_method_name" }] }),
        list(accTables.currencies, { order: [{ column: "code" }] }),
        list(accTables.fiscalYears, { order: [{ column: "start_date", ascending: false }] }),
        list(accTables.partyTypes, { order: [{ column: "sequence" }] }),
        list(accTables.partySubTypes, { order: [{ column: "sequence" }] }),
        list(accTables.companies, { order: [{ column: "created_at" }] }),
        list(accTables.taxDefinitions, { order: [{ column: "rate" }] }),
        list(accTables.revenueCategories, { order: [{ column: "revenue_category_name" }] }),
    ]);
    const active = (rows) => rows.filter((r) => r.status === undefined || r.status === "Active");
    return {
        accounts: active(accounts).map((a) => ({
            id: a.id, code: a.code, name: a.name, parentId: a.parentId, accountType: a.accountType, nature: a.nature,
            category: a.category, reportSection: a.reportSection, isBankAccount: a.isBankAccount, isCashAccount: a.isCashAccount,
            allowPosting: a.allowPosting,
        })),
        ledgers: active(accounts)
            .filter((a) => a.accountType === "Ledger" && a.allowPosting)
            .map((a) => ({ id: a.id, code: a.code, name: a.name, nature: a.nature, category: a.category, isBankAccount: a.isBankAccount, isCashAccount: a.isCashAccount })),
        bankCashAccounts: active(accounts)
            .filter((a) => a.accountType === "Ledger" && (a.isBankAccount || a.isCashAccount))
            .map((a) => ({ id: a.id, code: a.code, name: a.name, isBankAccount: a.isBankAccount, isCashAccount: a.isCashAccount })),
        parties: parties
            .filter((p) => p.status !== "Inactive")
            .map((p) => ({
            id: p.id, partyCode: p.partyCode, partyName: p.partyName, partyGroup: p.partyGroup, partyTypeId: p.partyTypeId,
            receivableAccountId: p.receivableAccountId, payableAccountId: p.payableAccountId, creditDays: p.creditDays, status: p.status,
        })),
        divisions: active(divisions).map((d) => ({ id: d.id, divisionCode: d.divisionCode, divisionName: d.divisionName, parentDivisionId: d.parentDivisionId })),
        voucherTypes: active(voucherTypes).map((v) => ({
            id: v.id, voucherTypeName: v.voucherTypeName, shortCode: v.shortCode, category: v.category, partyRequired: v.partyRequired,
            divisionRequired: v.divisionRequired, numberingMethod: v.numberingMethod,
        })),
        paymentMethods: active(paymentMethods).map((m) => ({
            id: m.id, paymentMethodCode: m.paymentMethodCode, paymentMethodName: m.paymentMethodName, methodType: m.methodType,
            referenceRequired: m.referenceRequired, accountId: m.accountId,
        })),
        currencies: active(currencies).map((c) => ({ id: c.id, code: c.code, name: c.name, symbol: c.symbol, isBaseCurrency: c.isBaseCurrency })),
        fiscalYears: fiscalYears.map((f) => ({
            id: f.id, fiscalYearName: f.fiscalYearName, fyCode: f.fyCode, startDate: f.startDate, endDate: f.endDate, status: f.status, isCurrent: f.isCurrent,
        })),
        partyTypes: active(partyTypes).map((t) => ({ id: t.id, typeCode: t.typeCode, typeName: t.typeName })),
        partySubTypes: active(partySubTypes).map((t) => ({ id: t.id, partyTypeId: t.partyTypeId, subTypeCode: t.subTypeCode, subTypeName: t.subTypeName })),
        companies: companies.map((c) => ({ id: c.id, companyCode: c.companyCode, tradeName: c.tradeName, legalName: c.legalName, status: c.status })),
        taxes: active(taxes).map((t) => ({ id: t.id, taxCode: t.taxCode, taxName: t.taxName, rate: Number(t.rate) })),
        revenueCategories: active(revenueCategories).map((r) => ({ id: r.id, revenueCategoryCode: r.revenueCategoryCode, revenueCategoryName: r.revenueCategoryName })),
    };
});
export const accountTree = handle(async (req) => {
    const to = isIsoDate(q(req).asOn) ? q(req).asOn : undefined;
    const [accounts, lines] = await Promise.all([loadAccounts(), loadLines({ to })]);
    const txnCount = new Map();
    for (const l of lines)
        txnCount.set(l.accountId, (txnCount.get(l.accountId) ?? 0) + 1);
    const tree = buildTree(accounts, sumByAccount(lines));
    const decorate = (nodes) => nodes.map((n) => ({
        ...n,
        transactionCount: txnCount.get(n.id) ?? 0,
        balance: Math.abs(n.net),
        balanceSide: n.net >= 0 ? "Dr" : "Cr",
        children: decorate(n.children),
    }));
    return decorate(tree);
});
// ---------------------------------------------------------------------------
// Fiscal
// ---------------------------------------------------------------------------
export const fiscalYearActions = {
    open: handle((req) => fiscal.openFiscalYear(id(req))),
    setCurrent: handle((req) => fiscal.setCurrentFiscalYear(id(req))),
    close: handle((req) => fiscal.closeFiscalYear(id(req))),
    reopen: handle((req) => fiscal.reopenFiscalYear(id(req), String(body(req).reason ?? ""))),
};
export const periods = {
    list: handle((req) => fiscal.listPeriods(q(req).fiscalYearId)),
    close: handle((req) => fiscal.closePeriod(id(req), { force: body(req).force === true })),
    reopen: handle((req) => fiscal.reopenPeriod(id(req), String(body(req).reason ?? ""))),
};
export const auditLogs = handle((req) => fiscal.listAuditLogs({
    entityType: q(req).entityType,
    entityId: isUuid(q(req).entityId) ? q(req).entityId : undefined,
    limit: q(req).limit ? Number(q(req).limit) : undefined,
}));
// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------
export const voucherHandlers = {
    list: handle((req) => vouchers.listVouchers(q(req))),
    get: handle((req) => vouchers.getVoucher(id(req))),
    nextNumber: handle((req) => vouchers.previewNextNumber(String(q(req).voucherTypeId ?? ""), q(req).date)),
    create: handle((req) => vouchers.createVoucher(body(req)), 201),
    update: handle((req) => vouchers.updateVoucher(id(req), body(req))),
    remove: handle((req) => vouchers.deleteVoucher(id(req))),
    post: handle((req) => vouchers.postVoucher(id(req), body(req))),
    reverse: handle((req) => vouchers.reverseVoucher(id(req), String(body(req).reason ?? ""))),
    convert: handle((req) => vouchers.convertProvisional(id(req), body(req))),
    print: handle((req) => vouchers.markPrinted(id(req))),
    receiptPayment: handle((req) => vouchers.createReceiptPayment(body(req)), 201),
};
export const bankRecon = {
    get: handle((req) => vouchers.bankReconciliation(q(req))),
    reconcile: handle((req) => vouchers.reconcileLines(body(req).items)),
    unreconcile: handle((req) => vouchers.unreconcileLines(body(req).lineIds, String(body(req).reason ?? ""))),
};
export const closingStockPost = handle((req) => vouchers.postClosingStock(body(req)));
// ---------------------------------------------------------------------------
// Bills & covering letters
// ---------------------------------------------------------------------------
export const billHandlers = {
    list: handle((req) => bills.listBills(q(req))),
    get: handle((req) => bills.getBill(id(req))),
    create: handle((req) => bills.createBill(body(req)), 201),
    update: handle((req) => bills.updateBill(id(req), body(req))),
    cancel: handle((req) => bills.cancelBill(id(req), String(body(req).reason ?? ""))),
    settle: handle((req) => bills.settleBill(id(req), body(req))),
    removeSettlement: handle((req) => bills.deleteSettlement(id(req))),
};
export const coveringLetterHandlers = {
    list: handle((req) => bills.listCoveringLetters(q(req))),
    candidates: handle((req) => bills.coveringLetterCandidates(q(req))),
    create: handle((req) => bills.createCoveringLetter(body(req)), 201),
    reverse: handle((req) => bills.reverseCoveringLetter(id(req), String(body(req).reason ?? ""))),
};
// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const reportHandlers = {
    trialBalance: handle((req) => reports.trialBalance(q(req))),
    profitLoss: handle((req) => reports.profitLoss(q(req))),
    balanceSheet: handle((req) => reports.balanceSheet(q(req))),
    generalLedger: handle((req) => reports.generalLedger(q(req))),
    dayBook: handle((req) => reports.dayBook(q(req))),
    outstandingBills: handle((req) => reports.outstandingBills(q(req))),
    agingSummary: handle((req) => reports.agingSummary(q(req))),
    partySettlement: handle((req) => reports.partySettlement(q(req))),
    reminderLetters: handle((req) => reports.reminderLetters(q(req))),
    balanceConfirmation: handle((req) => reports.balanceConfirmation(q(req))),
    paymentAdvice: handle((req) => reports.paymentAdvice(q(req))),
    analysis: handle((req) => reports.financialAnalysis(q(req))),
    dashboard: handle((req) => reports.dashboard(q(req))),
};
//# sourceMappingURL=index.js.map
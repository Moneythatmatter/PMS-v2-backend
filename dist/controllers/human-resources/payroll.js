import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import { enrichPayrollRecord, enrichPayrollRecords, mapPayrollIncoming, } from "../../services/human-resources/enrich.js";
import { approveBatch, approveRecord, assertEditable, calculatePayroll, getRecordOrThrow, listPayments, payrollExtras, recordPayment, sendPayslip, sendPayslipsBatch, unlockRecord, updatePayrollAmounts, verifyBatch, verifyRecord, } from "../../services/human-resources/payroll.service.js";
import { supabase } from "../../utils/supabase.js";
import { fromError, ok } from "../../utils/response.js";
const actorNames = new Map();
/** Name of the signed-in user, for audit trails and "recorded by". */
async function actorOf(req) {
    const auth = req.auth;
    if (!auth?.userId)
        return "System";
    const cached = actorNames.get(auth.userId);
    if (cached)
        return cached;
    const { data } = await supabase.from("users").select("name").eq("id", auth.userId).maybeSingle();
    const name = String(data?.name ?? auth.email ?? "User");
    actorNames.set(auth.userId, name);
    return name;
}
async function withExtras(rows) {
    const [enriched, extras] = await Promise.all([
        enrichPayrollRecords(rows),
        payrollExtras(rows.map((r) => r.id)),
    ]);
    return enriched.map((row) => {
        const extra = extras.get(row.id);
        const paidAmount = extra?.paidAmount ?? 0;
        return {
            ...row,
            ...extra,
            paidAmount,
            balanceAmount: Math.max(0, Math.round((Number(row.netSalary) - paidAmount) * 100) / 100),
        };
    });
}
async function respondWithRecord(res, id, status = 200) {
    const row = await getRecordOrThrow(id);
    const [record] = await withExtras([row]);
    return ok(res, record, status);
}
const ids = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : undefined);
const num = (value) => (value === undefined || value === null || value === "" ? undefined : Number(value));
export async function listPayrollRecords(req, res) {
    try {
        const month = req.query.month ? Number(req.query.month) : undefined;
        const year = req.query.year ? Number(req.query.year) : undefined;
        const filters = {};
        if (month)
            filters.payroll_month = month;
        if (year)
            filters.payroll_year = year;
        const rows = await hrModel.list(hrTables.payrollRecords, {
            filters,
            orderBy: "created_at",
            ascending: false,
        });
        return ok(res, await withExtras(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getPayrollRecord(req, res) {
    try {
        return await respondWithRecord(res, String(req.params.id));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createPayrollRecord(req, res) {
    try {
        const body = mapPayrollIncoming({ ...req.body }, true);
        for (const key of ["status", "isLocked", "approvedAt", "verifiedAt", "payslipGenerated"])
            delete body[key];
        body.status = "Draft";
        if (!body.id)
            body.id = newId();
        const row = await hrModel.create(hrTables.payrollRecords, body);
        return ok(res, await enrichPayrollRecord(row), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Edit earnings / deductions. Blocked once approved (locked). Status changes go through the workflow endpoints. */
export async function updatePayrollRecord(req, res) {
    try {
        const id = String(req.params.id);
        assertEditable(await getRecordOrThrow(id));
        const body = req.body;
        const pick = (keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, Number(body[k])]));
        await updatePayrollAmounts(id, {
            earnings: pick(["basicSalary", "hra", "allowances", "overtimePay", "holidayPay", "incentives", "bonus", "otherEarnings"]),
            deductions: pick(["leaveDeduction", "pfDeduction", "esiDeduction", "ptDeduction", "tdsDeduction", "otherDeductions"]),
            reason: body.overrideReason ? String(body.overrideReason) : undefined,
        }, await actorOf(req));
        return await respondWithRecord(res, id);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function calculatePayrollRecords(req, res) {
    try {
        const body = req.body;
        const result = await calculatePayroll({
            month: Number(body.month),
            year: Number(body.year),
            employeeIds: ids(body.employeeIds),
            actor: await actorOf(req),
        });
        return ok(res, result);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function verifyPayrollRecord(req, res) {
    try {
        const id = String(req.params.id);
        await verifyRecord(id, await actorOf(req));
        return await respondWithRecord(res, id);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function verifyPayrollBatch(req, res) {
    try {
        const body = req.body;
        return ok(res, await verifyBatch({ ids: ids(body.ids), month: num(body.month), year: num(body.year) }, await actorOf(req)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function approvePayrollRecord(req, res) {
    try {
        const id = String(req.params.id);
        await approveRecord(id, await actorOf(req));
        return await respondWithRecord(res, id);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function approvePayrollBatch(req, res) {
    try {
        const body = req.body;
        return ok(res, await approveBatch({ ids: ids(body.ids), month: num(body.month), year: num(body.year) }, await actorOf(req)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function unlockPayrollRecord(req, res) {
    try {
        const id = String(req.params.id);
        await unlockRecord(id, String(req.body?.reason ?? ""), await actorOf(req));
        return await respondWithRecord(res, id);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function recordSalaryPayment(req, res) {
    try {
        const result = await recordPayment(String(req.params.id), req.body, await actorOf(req));
        return ok(res, result, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listSalaryPayments(req, res) {
    try {
        return ok(res, await listPayments(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function sendPayslipById(req, res) {
    try {
        return ok(res, await sendPayslip(String(req.params.id), await actorOf(req)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function sendPayslipBatch(req, res) {
    try {
        const body = req.body;
        return ok(res, await sendPayslipsBatch({ ids: ids(body.ids), payrollIds: ids(body.payrollIds), month: num(body.month), year: num(body.year) }, await actorOf(req)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listAuditLogs(_req, res) {
    try {
        const rows = await hrModel.list(hrTables.auditLogs, {
            filters: { module: "payroll" },
            orderBy: "created_at",
            ascending: false,
            limit: 100,
        });
        return ok(res, rows.map((log) => ({
            id: log.id,
            action: log.action,
            changedBy: log.changedBy,
            changedOn: log.createdAt,
            auditNotes: log.auditNotes,
            overrideReason: log.overrideReason,
        })));
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=payroll.js.map
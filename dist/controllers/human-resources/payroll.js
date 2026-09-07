import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import { enrichPayrollRecord, enrichPayrollRecords, mapPayrollIncoming, } from "../../services/human-resources/enrich.js";
import { fail, fromError, ok } from "../../utils/response.js";
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
        return ok(res, await enrichPayrollRecords(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getPayrollRecord(req, res) {
    try {
        const row = await hrModel.get(hrTables.payrollRecords, String(req.params.id));
        if (!row)
            return fail(res, "Payroll record not found", 404);
        return ok(res, await enrichPayrollRecord(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createPayrollRecord(req, res) {
    try {
        let body = mapPayrollIncoming({ ...req.body }, true);
        if (!body.id)
            body.id = newId();
        const row = await hrModel.create(hrTables.payrollRecords, body);
        return ok(res, await enrichPayrollRecord(row), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updatePayrollRecord(req, res) {
    try {
        let body = mapPayrollIncoming({ ...req.body }, false);
        delete body.id;
        const row = await hrModel.update(hrTables.payrollRecords, String(req.params.id), body);
        return ok(res, await enrichPayrollRecord(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function approvePayrollRecord(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hrModel.get(hrTables.payrollRecords, id);
        if (!existing)
            return fail(res, "Payroll record not found", 404);
        if (existing.status === "Approved" || existing.status === "Paid") {
            return fail(res, "Payroll already approved or paid", 409);
        }
        const now = new Date().toISOString();
        const row = await hrModel.update(hrTables.payrollRecords, id, {
            status: "Approved",
            approvedAt: now,
            updatedAt: now,
        });
        await hrModel.create(hrTables.auditLogs, {
            id: newId(),
            module: "payroll",
            action: `Approved payroll record ${id}`,
            entityType: "payroll_record",
            entityId: id,
            changedBy: req.body?.changedBy ?? "HR Manager",
        });
        return ok(res, await enrichPayrollRecord(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function recordSalaryPayment(req, res) {
    try {
        const payrollId = String(req.params.id);
        const payroll = await hrModel.get(hrTables.payrollRecords, payrollId);
        if (!payroll)
            return fail(res, "Payroll record not found", 404);
        if (payroll.status !== "Approved") {
            return fail(res, "Payroll must be approved before recording payment", 400);
        }
        const body = req.body;
        const now = new Date().toISOString();
        const payment = await hrModel.create(hrTables.salaryPayments, {
            id: newId(),
            payrollId,
            employeeId: payroll.employeeId,
            amount: body.amount ?? payroll.netSalary,
            paymentDate: body.paymentDate,
            paymentMode: body.paymentMode ?? "Bank Transfer",
            transactionReference: body.transactionReference,
            status: body.status ?? "Completed",
            remarks: body.remarks ?? "",
            recordedBy: body.recordedBy ?? "HR Manager",
            createdAt: now,
            updatedAt: now,
        });
        if ((body.status ?? "Completed") === "Completed") {
            await hrModel.update(hrTables.payrollRecords, payrollId, {
                status: "Paid",
                updatedAt: now,
            });
        }
        await hrModel.create(hrTables.auditLogs, {
            id: newId(),
            module: "payroll",
            action: `Recorded salary payment for payroll ${payrollId}`,
            entityType: "salary_payment",
            entityId: payment.id,
            changedBy: String(body.recordedBy ?? "HR Manager"),
            auditNotes: body.remarks ? String(body.remarks) : undefined,
        });
        return ok(res, payment, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listAuditLogs(_req, res) {
    try {
        const rows = await hrModel.list(hrTables.auditLogs, {
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
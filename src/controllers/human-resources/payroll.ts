import type { Request, Response } from "express";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import {
  enrichPayrollRecord,
  enrichPayrollRecords,
  mapPayrollIncoming,
} from "../../services/human-resources/enrich.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function listPayrollRecords(req: Request, res: Response) {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const filters: Record<string, string | number> = {};
    if (month) filters.payroll_month = month;
    if (year) filters.payroll_year = year;
    const rows = await hrModel.list(hrTables.payrollRecords, {
      filters,
      orderBy: "created_at",
      ascending: false,
    });
    return ok(res, await enrichPayrollRecords(rows as Parameters<typeof enrichPayrollRecords>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getPayrollRecord(req: Request, res: Response) {
  try {
    const row = await hrModel.get(hrTables.payrollRecords, String(req.params.id));
    if (!row) return fail(res, "Payroll record not found", 404);
    return ok(res, await enrichPayrollRecord(row as Parameters<typeof enrichPayrollRecord>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createPayrollRecord(req: Request, res: Response) {
  try {
    let body = mapPayrollIncoming({ ...(req.body as Record<string, unknown>) }, true);
    if (!body.id) body.id = newId();
    const row = await hrModel.create(hrTables.payrollRecords, body);
    return ok(res, await enrichPayrollRecord(row as Parameters<typeof enrichPayrollRecord>[0]), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updatePayrollRecord(req: Request, res: Response) {
  try {
    let body = mapPayrollIncoming({ ...(req.body as Record<string, unknown>) }, false);
    delete body.id;
    const row = await hrModel.update(hrTables.payrollRecords, String(req.params.id), body);
    return ok(res, await enrichPayrollRecord(row as Parameters<typeof enrichPayrollRecord>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approvePayrollRecord(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = await hrModel.get<{ status: string }>(hrTables.payrollRecords, id);
    if (!existing) return fail(res, "Payroll record not found", 404);
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
      changedBy: (req.body as { changedBy?: string })?.changedBy ?? "HR Manager",
    });
    return ok(res, await enrichPayrollRecord(row as Parameters<typeof enrichPayrollRecord>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function recordSalaryPayment(req: Request, res: Response) {
  try {
    const payrollId = String(req.params.id);
    const payroll = await hrModel.get<{ status: string; employeeId: string; netSalary: number }>(
      hrTables.payrollRecords,
      payrollId,
    );
    if (!payroll) return fail(res, "Payroll record not found", 404);
    if (payroll.status !== "Approved") {
      return fail(res, "Payroll must be approved before recording payment", 400);
    }

    const body = req.body as Record<string, unknown>;
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
      entityId: (payment as { id: string }).id,
      changedBy: String(body.recordedBy ?? "HR Manager"),
      auditNotes: body.remarks ? String(body.remarks) : undefined,
    });

    return ok(res, payment, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listAuditLogs(_req: Request, res: Response) {
  try {
    const rows = await hrModel.list(hrTables.auditLogs, {
      orderBy: "created_at",
      ascending: false,
      limit: 100,
    });
    return ok(res, (rows as Record<string, unknown>[]).map((log) => ({
      id: log.id,
      action: log.action,
      changedBy: log.changedBy,
      changedOn: log.createdAt,
      auditNotes: log.auditNotes,
      overrideReason: log.overrideReason,
    })));
  } catch (e) {
    return fromError(res, e);
  }
}

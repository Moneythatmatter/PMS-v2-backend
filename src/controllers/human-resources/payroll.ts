import type { Request, Response } from "express";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import {
  enrichPayrollRecord,
  enrichPayrollRecords,
  mapPayrollIncoming,
} from "../../services/human-resources/enrich.js";
import {
  approveBatch,
  approveRecord,
  assertEditable,
  calculatePayroll,
  getRecordOrThrow,
  listPayments,
  payrollExtras,
  recordPayment,
  sendPayslip,
  sendPayslipsBatch,
  unlockRecord,
  updatePayrollAmounts,
  verifyBatch,
  verifyRecord,
  type PayrollRecordRow,
} from "../../services/human-resources/payroll.service.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { supabase } from "../../utils/supabase.js";
import { fromError, ok } from "../../utils/response.js";

const actorNames = new Map<string, string>();

/** Name of the signed-in user, for audit trails and "recorded by". */
async function actorOf(req: Request): Promise<string> {
  const auth = (req as AuthedRequest).auth;
  if (!auth?.userId) return "System";
  const cached = actorNames.get(auth.userId);
  if (cached) return cached;
  const { data } = await supabase.from("users").select("name").eq("id", auth.userId).maybeSingle();
  const name = String(data?.name ?? auth.email ?? "User");
  actorNames.set(auth.userId, name);
  return name;
}

async function withExtras(rows: PayrollRecordRow[]) {
  const [enriched, extras] = await Promise.all([
    enrichPayrollRecords(rows as Parameters<typeof enrichPayrollRecords>[0]),
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

async function respondWithRecord(res: Response, id: string, status = 200) {
  const row = await getRecordOrThrow(id);
  const [record] = await withExtras([row]);
  return ok(res, record, status);
}

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : undefined);
const num = (value: unknown) => (value === undefined || value === null || value === "" ? undefined : Number(value));

export async function listPayrollRecords(req: Request, res: Response) {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const filters: Record<string, string | number> = {};
    if (month) filters.payroll_month = month;
    if (year) filters.payroll_year = year;
    const rows = await hrModel.list<PayrollRecordRow>(hrTables.payrollRecords, {
      filters,
      orderBy: "created_at",
      ascending: false,
    });
    return ok(res, await withExtras(rows));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getPayrollRecord(req: Request, res: Response) {
  try {
    return await respondWithRecord(res, String(req.params.id));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createPayrollRecord(req: Request, res: Response) {
  try {
    const body = mapPayrollIncoming({ ...(req.body as Record<string, unknown>) }, true);
    for (const key of ["status", "isLocked", "approvedAt", "verifiedAt", "payslipGenerated"]) delete body[key];
    body.status = "Draft";
    if (!body.id) body.id = newId();
    const row = await hrModel.create(hrTables.payrollRecords, body);
    return ok(res, await enrichPayrollRecord(row as Parameters<typeof enrichPayrollRecord>[0]), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

/** Edit earnings / deductions. Blocked once approved (locked). Status changes go through the workflow endpoints. */
export async function updatePayrollRecord(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    assertEditable(await getRecordOrThrow(id));
    const body = req.body as Record<string, unknown>;
    const pick = (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, Number(body[k])]));
    await updatePayrollAmounts(
      id,
      {
        earnings: pick(["basicSalary", "hra", "allowances", "overtimePay", "holidayPay", "incentives", "bonus", "otherEarnings"]),
        deductions: pick(["leaveDeduction", "pfDeduction", "esiDeduction", "ptDeduction", "tdsDeduction", "otherDeductions"]),
        reason: body.overrideReason ? String(body.overrideReason) : undefined,
      },
      await actorOf(req),
    );
    return await respondWithRecord(res, id);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function calculatePayrollRecords(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const result = await calculatePayroll({
      month: Number(body.month),
      year: Number(body.year),
      employeeIds: ids(body.employeeIds),
      actor: await actorOf(req),
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function verifyPayrollRecord(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    await verifyRecord(id, await actorOf(req));
    return await respondWithRecord(res, id);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function verifyPayrollBatch(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    return ok(res, await verifyBatch({ ids: ids(body.ids), month: num(body.month), year: num(body.year) }, await actorOf(req)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approvePayrollRecord(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    await approveRecord(id, await actorOf(req));
    return await respondWithRecord(res, id);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approvePayrollBatch(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    return ok(res, await approveBatch({ ids: ids(body.ids), month: num(body.month), year: num(body.year) }, await actorOf(req)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function unlockPayrollRecord(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    await unlockRecord(id, String((req.body as { reason?: string })?.reason ?? ""), await actorOf(req));
    return await respondWithRecord(res, id);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function recordSalaryPayment(req: Request, res: Response) {
  try {
    const result = await recordPayment(String(req.params.id), req.body as Record<string, unknown>, await actorOf(req));
    return ok(res, result, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listSalaryPayments(req: Request, res: Response) {
  try {
    return ok(res, await listPayments(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function sendPayslipById(req: Request, res: Response) {
  try {
    return ok(res, await sendPayslip(String(req.params.id), await actorOf(req)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function sendPayslipBatch(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    return ok(
      res,
      await sendPayslipsBatch(
        { ids: ids(body.ids), payrollIds: ids(body.payrollIds), month: num(body.month), year: num(body.year) },
        await actorOf(req),
      ),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listAuditLogs(_req: Request, res: Response) {
  try {
    const rows = await hrModel.list(hrTables.auditLogs, {
      filters: { module: "payroll" },
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

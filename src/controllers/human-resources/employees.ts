import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newCode, newId } from "../../models/front-office/base.js";
import { clearHrLookupCache, enrichEmployee, enrichEmployees } from "../../services/human-resources/enrich.js";
import { fail, fromError, ok } from "../../utils/response.js";

/** Postgres rejects "" for date/uuid FK columns — coerce blanks to null. */
const EMPLOYEE_NULLABLE_KEYS = [
  "departmentId",
  "designationId",
  "employmentTypeId",
  "shiftTypeId",
  "leavePolicyId",
  "salaryStructureId",
  "joinDate",
  "dob",
  "phone",
  "gender",
  "address",
  "bloodGroup",
  "emergencyContact",
  "reportingManager",
  "avatar",
  "photoUrl",
  "bankAccount",
  "bankName",
  "ifscCode",
  "panNumber",
  "uanNumber",
  "esicNumber",
] as const;

function sanitizeEmployeePayload(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const key of EMPLOYEE_NULLABLE_KEYS) {
    if (out[key] === "" || out[key] === undefined) out[key] = null;
  }
  return out;
}

function applyNameSplit(body: Record<string, unknown>, force = false) {
  if (!body.name) return;
  if (!force && body.firstName) return;
  const parts = String(body.name).split(" ").filter(Boolean);
  body.firstName = parts[0] ?? body.firstName;
  body.lastName = parts.slice(1).join(" ") || parts[0] || body.lastName;
  delete body.name;
}

export async function listEmployees(_req: ContextRequest, res: Response) {
  try {
    const rows = await hrModel.list(hrTables.employees, { orderBy: "emp_code" });
    return ok(res, await enrichEmployees(rows as Parameters<typeof enrichEmployees>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getEmployee(req: ContextRequest, res: Response) {
  try {
    const row = await hrModel.get(hrTables.employees, String(req.params.id));
    if (!row) return fail(res, "Employee not found", 404);
    return ok(res, await enrichEmployee(row as Parameters<typeof enrichEmployee>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createEmployee(req: ContextRequest, res: Response) {
  try {
    let body = sanitizeEmployeePayload({ ...(req.body as Record<string, unknown>) });
    if (!body.id) body.id = newId();
    if (!body.empCode || String(body.empCode).trim() === "") {
      body.empCode = newCode("EMP");
    }
    applyNameSplit(body);
    clearHrLookupCache(req.propertyId);
    const row = await hrModel.create(hrTables.employees, body);
    return ok(res, await enrichEmployee(row as Parameters<typeof enrichEmployee>[0]), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateEmployee(req: ContextRequest, res: Response) {
  try {
    let body = sanitizeEmployeePayload({ ...(req.body as Record<string, unknown>) });
    delete body.id;
    applyNameSplit(body, true);
    clearHrLookupCache(req.propertyId);
    const row = await hrModel.update(hrTables.employees, String(req.params.id), body);
    return ok(res, await enrichEmployee(row as Parameters<typeof enrichEmployee>[0]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteEmployee(req: ContextRequest, res: Response) {
  try {
    await hrModel.remove(hrTables.employees, String(req.params.id));
    clearHrLookupCache(req.propertyId);
    return ok(res, { id: req.params.id });
  } catch (e) {
    return fromError(res, e);
  }
}

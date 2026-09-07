import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import { clearHrLookupCache, enrichEmployee, enrichEmployees } from "../../services/human-resources/enrich.js";
import { fail, fromError, ok } from "../../utils/response.js";

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
    const body = { ...(req.body as Record<string, unknown>) };
    if (!body.id) body.id = newId();
    if (body.name && !body.firstName) {
      const parts = String(body.name).split(" ");
      body.firstName = parts[0];
      body.lastName = parts.slice(1).join(" ") || parts[0];
      delete body.name;
    }
    clearHrLookupCache(req.propertyId);
    const row = await hrModel.create(hrTables.employees, body);
    return ok(res, await enrichEmployee(row as Parameters<typeof enrichEmployee>[0]), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateEmployee(req: ContextRequest, res: Response) {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    if (body.name) {
      const parts = String(body.name).split(" ");
      body.firstName = parts[0];
      body.lastName = parts.slice(1).join(" ") || parts[0];
      delete body.name;
    }
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

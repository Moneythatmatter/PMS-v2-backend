import type { Response } from "express";
import { TenantService } from "../../services/saas/tenant.service.js";
import { UserAdminService } from "../../services/platform/user-admin.service.js";
import { fromError, ok } from "../../utils/response.js";
import type { ContextRequest } from "../../middleware/request-context.js";

function authCtx(req: ContextRequest) {
  if (!req.auth?.userId) throw new Error("Unauthorized");
  return req.auth;
}

export async function listTenants(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    if (!auth.isSuperAdmin) {
      UserAdminService.assertSuperAdmin(false);
    }
    const rows = await TenantService.listTenants();
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createTenant(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    if (!auth.isSuperAdmin) {
      UserAdminService.assertSuperAdmin(false);
    }
    const body = req.body as Record<string, unknown>;
    const row = await TenantService.createTenant({
      name: String(body.name ?? ""),
      slug: body.slug ? String(body.slug) : undefined,
      adminName: String(body.adminName ?? body.admin_name ?? ""),
      adminEmail: String(body.adminEmail ?? body.admin_email ?? ""),
      adminPassword: String(body.adminPassword ?? body.admin_password ?? ""),
      propertyLimit:
        body.propertyLimit != null || body.property_limit != null
          ? Number(body.propertyLimit ?? body.property_limit)
          : undefined,
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateTenantStatus(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    if (!auth.isSuperAdmin) {
      UserAdminService.assertSuperAdmin(false);
    }
    const body = req.body as Record<string, unknown>;
    const row = await TenantService.updateTenantStatus(
      String(req.params.id),
      String(body.status ?? ""),
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateTenantPropertyLimit(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    if (!auth.isSuperAdmin) {
      UserAdminService.assertSuperAdmin(false);
    }
    const body = req.body as Record<string, unknown>;
    const row = await TenantService.updateTenantPropertyLimit(
      String(req.params.id),
      body.propertyLimit ?? body.property_limit,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

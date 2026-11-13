import type { Response } from "express";
import { PortfolioService } from "../../services/platform/portfolio.service.js";
import { PropertyService } from "../../services/platform/property.service.js";
import { UserAdminService } from "../../services/platform/user-admin.service.js";
import { RoleService } from "../../services/platform/role.service.js";
import { TenantService } from "../../services/saas/tenant.service.js";
import { PLATFORM_ACCESS_GROUPS, type PermissionLevel } from "../../types/platform.js";
import { fromError, ok } from "../../utils/response.js";
import type { ContextRequest } from "../../middleware/request-context.js";
import { AppError, PermissionError } from "../../errors/index.js";

function authCtx(req: ContextRequest) {
  if (!req.auth?.userId) throw new Error("Unauthorized");
  return req.auth;
}

async function assertCanManageProperties(auth: {
  userId: string;
  isSuperAdmin?: boolean;
  role?: string;
}) {
  if (auth.isSuperAdmin) return;
  const isTenantAdmin = await TenantService.isTenantAdmin(auth.userId);
  if (isTenantAdmin) return;
  if (await UserAdminService.userHasPageGrant(auth.userId, "workspace.user_management")) return;
  if (await UserAdminService.userHasPageGrant(auth.userId, "workspace.roles")) return;
  UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
}

function parseRolePermissions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const row = p as Record<string, unknown>;
      return {
        moduleKey: String(row.moduleKey ?? ""),
        permission: String(row.permission ?? "") as PermissionLevel,
      };
    })
    .map((p) => ({
      ...p,
      permission: (p.permission === "admin" ? "write" : p.permission) as PermissionLevel,
    }))
    .filter((p) => p.moduleKey && (p.permission === "read" || p.permission === "write"));
}

export async function listProperties(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    const rows = await PropertyService.listForUser(
      auth.userId,
      auth.isSuperAdmin,
      auth.role,
    );
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createProperty(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;

    let tenantId = body.tenantId ? String(body.tenantId) : "";
    if (!tenantId) {
      tenantId = (await TenantService.getPrimaryTenantId(auth.userId)) ?? "";
    }
    if (!tenantId) {
      throw new AppError("No tenant linked to this user", 400);
    }
    if (!auth.isSuperAdmin) {
      const allowed = await TenantService.isTenantAdmin(auth.userId, tenantId);
      if (!allowed) throw new PermissionError("Tenant admin access required");
    }

    const row = await PropertyService.create({
      name: String(body.name ?? ""),
      code: String(body.code ?? ""),
      city: body.city ? String(body.city) : undefined,
      timezone: body.timezone ? String(body.timezone) : undefined,
      isDefault: Boolean(body.isDefault),
      tenantId,
      ownerUserId: auth.userId,
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteProperty(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const propertyId = String(req.params.id ?? "").trim();

    if (!auth.isSuperAdmin) {
      const allowed = await PropertyService.userCanAccessProperty(
        auth.userId,
        propertyId,
        false,
        auth.role,
      );
      if (!allowed) throw new PermissionError("You cannot delete this property");
    }

    const result = await PropertyService.delete(propertyId);
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateProperty(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;
    const row = await PropertyService.update(String(req.params.id), {
      name: body.name != null ? String(body.name) : undefined,
      code: body.code != null ? String(body.code) : undefined,
      city: body.city != null ? String(body.city) : undefined,
      timezone: body.timezone != null ? String(body.timezone) : undefined,
      status: body.status != null ? String(body.status) : undefined,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getPortfolio(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    const snapshot = await PortfolioService.snapshot({
      userId: auth.userId,
      isSuperAdmin: auth.isSuperAdmin,
      role: auth.role,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
    });
    return ok(res, snapshot);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listModules(_req: ContextRequest, res: Response) {
  return ok(res, PLATFORM_ACCESS_GROUPS);
}

export async function listUsers(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const rows = await UserAdminService.listUsers();
    // Platform Super Admin can see everyone (product console / support).
    if (auth.isSuperAdmin) return ok(res, rows);

    const tenantId = await TenantService.getPrimaryTenantId(auth.userId);
    if (!tenantId) return ok(res, []);

    // Strict tenant isolation: only users belonging to this tenant
    // (users.tenant_id or tenant_users membership) — never other tenants' staff.
    const memberIds = new Set(await TenantService.listUserIdsForTenant(tenantId));
    const scoped = rows.filter(
      (u) =>
        !u.isSuperAdmin &&
        (u.tenantId === tenantId || memberIds.has(u.id)),
    );
    return ok(res, scoped);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listEmployeeLinkOptions(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const propertyId = String(req.query.propertyId ?? "").trim();
    if (!propertyId) {
      throw new AppError("propertyId query parameter is required", 400);
    }
    const rows = await UserAdminService.listEmployeeLinkOptions(propertyId);
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createUser(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;
    const wantsSuper = Boolean(body.isSuperAdmin);
    if (wantsSuper && !auth.isSuperAdmin) {
      throw new PermissionError("Only platform admins can create super admins");
    }

    const tenantId =
      (body.tenantId ? String(body.tenantId) : null) ||
      (await TenantService.getPrimaryTenantId(auth.userId));

    if (!auth.isSuperAdmin && tenantId) {
      const okTenant = await TenantService.isTenantAdmin(auth.userId, tenantId);
      if (!okTenant) throw new PermissionError("Tenant admin access required");
    }

    const row = await UserAdminService.createUser({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      role: body.role ? String(body.role) : undefined,
      initials: body.initials ? String(body.initials) : undefined,
      isSuperAdmin: wantsSuper,
      propertyIds: Array.isArray(body.propertyIds)
        ? body.propertyIds.map(String)
        : [],
      permissions: Array.isArray(body.permissions) ? body.permissions : [],
      employeeId:
        body.employeeId === null || body.employeeId === ""
          ? null
          : body.employeeId
            ? String(body.employeeId)
            : undefined,
      tenantId: tenantId || undefined,
      accessRoleId:
        body.accessRoleId === null || body.accessRoleId === ""
          ? null
          : body.accessRoleId
            ? String(body.accessRoleId)
            : undefined,
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateUser(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;
    const row = await UserAdminService.updateUser(String(req.params.id), {
      name: body.name != null ? String(body.name) : undefined,
      role: body.role != null ? String(body.role) : undefined,
      status: body.status != null ? String(body.status) : undefined,
      isSuperAdmin:
        body.isSuperAdmin != null ? Boolean(body.isSuperAdmin) : undefined,
      propertyIds: Array.isArray(body.propertyIds)
        ? body.propertyIds.map(String)
        : undefined,
      permissions: Array.isArray(body.permissions) ? body.permissions : undefined,
      password: body.password ? String(body.password) : undefined,
      employeeId:
        body.employeeId === null || body.employeeId === ""
          ? null
          : body.employeeId != null
            ? String(body.employeeId)
            : undefined,
      accessRoleId:
        body.accessRoleId === null || body.accessRoleId === ""
          ? null
          : body.accessRoleId != null
            ? String(body.accessRoleId)
            : undefined,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listRoles(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const tenantId =
      (req.query.tenantId ? String(req.query.tenantId) : null) ||
      (await TenantService.getPrimaryTenantId(auth.userId));
    if (!tenantId) return ok(res, []);
    const rows = await RoleService.listForTenant(tenantId);
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createRole(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;
    const tenantId =
      (body.tenantId ? String(body.tenantId) : null) ||
      (await TenantService.getPrimaryTenantId(auth.userId));
    if (!tenantId) throw new AppError("Tenant required", 400);
    const row = await RoleService.create({
      tenantId,
      name: String(body.name ?? ""),
      description: body.description != null ? String(body.description) : "",
      permissions: parseRolePermissions(body.permissions),
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateRole(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    const body = req.body as Record<string, unknown>;
    const row = await RoleService.update(String(req.params.id), {
      name: body.name != null ? String(body.name) : undefined,
      description: body.description != null ? String(body.description) : undefined,
      status: body.status != null ? String(body.status) : undefined,
      permissions: body.permissions != null ? parseRolePermissions(body.permissions) : undefined,
      reapplyToUsers: body.reapplyToUsers != null ? Boolean(body.reapplyToUsers) : true,
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteRole(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    await assertCanManageProperties(auth);
    await RoleService.remove(String(req.params.id));
    return ok(res, { ok: true });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function myPermissions(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    const propertyId = String(req.query.propertyId ?? req.headers["x-property-id"] ?? "");
    if (!propertyId) {
      return fromError(res, new Error("propertyId query param required"), 400);
    }
    const allowed = await PropertyService.userCanAccessProperty(
      auth.userId,
      propertyId,
      auth.isSuperAdmin,
      auth.role,
    );
    if (!allowed) {
      return fromError(res, new Error("Forbidden"), 403);
    }
    const perms = await UserAdminService.getMyPermissions(
      auth.userId,
      propertyId,
      auth.isSuperAdmin,
      auth.role,
    );
    return ok(res, perms);
  } catch (e) {
    return fromError(res, e);
  }
}

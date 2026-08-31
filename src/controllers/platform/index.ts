import type { Response } from "express";
import { PropertyService } from "../../services/platform/property.service.js";
import { UserAdminService } from "../../services/platform/user-admin.service.js";
import { PLATFORM_MODULES } from "../../types/platform.js";
import { fromError, ok } from "../../utils/response.js";
import type { ContextRequest } from "../../middleware/request-context.js";

function authCtx(req: ContextRequest) {
  if (!req.auth?.userId) throw new Error("Unauthorized");
  return req.auth;
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
    UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
    const body = req.body as Record<string, unknown>;
    const row = await PropertyService.create({
      name: String(body.name ?? ""),
      code: String(body.code ?? ""),
      city: body.city ? String(body.city) : undefined,
      timezone: body.timezone ? String(body.timezone) : undefined,
      isDefault: Boolean(body.isDefault),
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateProperty(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
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

export async function listModules(_req: ContextRequest, res: Response) {
  return ok(res, PLATFORM_MODULES);
}

export async function listUsers(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
    const rows = await UserAdminService.listUsers();
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createUser(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
    const body = req.body as Record<string, unknown>;
    const row = await UserAdminService.createUser({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      role: body.role ? String(body.role) : undefined,
      initials: body.initials ? String(body.initials) : undefined,
      isSuperAdmin: Boolean(body.isSuperAdmin),
      propertyIds: Array.isArray(body.propertyIds)
        ? body.propertyIds.map(String)
        : [],
      permissions: Array.isArray(body.permissions) ? body.permissions : [],
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateUser(req: ContextRequest, res: Response) {
  try {
    const auth = authCtx(req);
    UserAdminService.assertSuperAdmin(auth.isSuperAdmin, auth.role);
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
    });
    return ok(res, row);
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
    );
    return ok(res, perms);
  } catch (e) {
    return fromError(res, e);
  }
}

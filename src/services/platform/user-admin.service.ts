import bcrypt from "bcryptjs";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError, PermissionError } from "../../errors/index.js";
import type { AuthUserPublic, AuthUserRow } from "../../types/auth.js";
import type {
  PermissionLevel,
  UserPermissionRow,
  UserPropertyAccessRow,
} from "../../types/platform.js";
import {
  LEGACY_MODULE_KEYS,
  PLATFORM_MODULES,
  PLATFORM_PAGE_KEYS,
} from "../../types/platform.js";
import { isPlatformAdmin } from "../../utils/platform-admin.js";
import { assertPropertiesBelongToTenant } from "../../utils/tenant-isolation.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { invalidateModuleAccessCache } from "../../middleware/module-access.js";
import { applyRolePermissionsToUser, RoleService } from "./role.service.js";

const USERS = "users";
const ACCESS = "user_property_access";
const PERMS = "user_permissions";

function toPublic(user: AuthUserRow): AuthUserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    tenantId: user.tenantId ?? null,
    employeeId: user.employeeId ?? null,
    accessRoleId: user.accessRoleId ?? null,
  };
}

export type ManagedUser = AuthUserPublic & {
  status: string;
  propertyIds: string[];
  permissions: UserPermissionRow[];
  employeeLabel?: string;
  accessRoleName?: string;
};

async function resolveEmployeeLabel(employeeId?: string | null): Promise<string | undefined> {
  if (!employeeId) return undefined;
  const emp = await hrModel.get<{
    empCode?: string;
    firstName?: string;
    lastName?: string;
  }>(hrTables.employees, employeeId);
  if (!emp) return undefined;
  return `${emp.empCode ?? employeeId} — ${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim();
}

async function assertEmployeeLink(input: {
  employeeId?: string | null;
  propertyIds: string[];
}) {
  if (!input.employeeId) return;
  const emp = await hrModel.get<{ propertyId?: string; status?: string }>(
    hrTables.employees,
    input.employeeId,
  );
  if (!emp) throw new AppError("Selected employee record not found", 400);
  if (emp.status && emp.status !== "Active") {
    throw new AppError("Selected employee is not active", 400);
  }
  if (emp.propertyId && !input.propertyIds.includes(emp.propertyId)) {
    throw new AppError(
      "Employee belongs to a property this user does not have access to",
      400,
    );
  }
}

export const UserAdminService = {
  assertSuperAdmin(isSuperAdmin?: boolean, role?: string) {
    if (!isPlatformAdmin({ isSuperAdmin, role: role ?? "" }))
      throw new PermissionError("Administrator access required");
  },

  async listUsers(): Promise<ManagedUser[]> {
    const { data: users, error } = await supabase.from(USERS).select("*").order("name");
    if (error) throw new AppError(error.message, 500);

    const rows = toCamel<AuthUserRow[]>(users ?? []);
    const result: ManagedUser[] = [];

    for (const user of rows) {
      const { data: access } = await supabase
        .from(ACCESS)
        .select("*")
        .eq("user_id", user.id);
      const { data: perms } = await supabase
        .from(PERMS)
        .select("*")
        .eq("user_id", user.id);

      const employeeLabel = await resolveEmployeeLabel(user.employeeId);
      let accessRoleName: string | undefined;
      if (user.accessRoleId) {
        try {
          const role = await RoleService.get(user.accessRoleId);
          accessRoleName = role.name;
        } catch {
          accessRoleName = undefined;
        }
      }
      result.push({
        ...toPublic(user),
        status: user.status ?? "Active",
        propertyIds: (access ?? []).map((a) => String(a.property_id)),
        permissions: toCamel<UserPermissionRow[]>(perms ?? []),
        employeeLabel,
        accessRoleName,
      });
    }
    return result;
  },

  async listEmployeeLinkOptions(propertyId: string) {
    const rows = await hrModel.list<{
      id: string;
      propertyId: string;
      empCode: string;
      firstName: string;
      lastName: string;
      email: string;
      status: string;
    }>(hrTables.employees, {
      filters: { property_id: propertyId, status: "Active" },
      orderBy: "emp_code",
    });
    return rows.map((e) => ({
      id: e.id,
      propertyId: e.propertyId,
      empCode: e.empCode,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email,
    }));
  },

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    role?: string;
    initials?: string;
    isSuperAdmin?: boolean;
    propertyIds?: string[];
    permissions?: Array<{
      propertyId: string;
      moduleKey: string;
      permission: PermissionLevel;
    }>;
    employeeId?: string | null;
    tenantId?: string;
    accessRoleId?: string | null;
  }): Promise<ManagedUser> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!email || !name || !input.password) {
      throw new AppError("Name, email, and password are required", 400);
    }

    const id = `U-${Date.now().toString(36).toUpperCase()}`;
    const passwordHash = await bcrypt.hash(input.password, 10);
    const initials =
      input.initials?.trim() ||
      name
        .split(/\s+/)
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    if (input.isSuperAdmin) {
      throw new AppError("Super Admin accounts can only be created from the platform console", 400);
    }
    let role = input.role?.trim() || "User";
    if (/^super\s*admin$/i.test(role)) {
      throw new AppError("Super Admin is reserved for the SaaS product owner", 400);
    }
    if (/^(admin|administrator)$/i.test(role)) {
      throw new AppError("Admin is the tenant owner account and cannot be created from User management", 400);
    }

    const propertyIds = input.propertyIds ?? [];
    await assertEmployeeLink({
      employeeId: input.employeeId,
      propertyIds,
    });

    let accessRoleId = input.accessRoleId ?? null;
    if (accessRoleId) {
      const accessRole = await RoleService.get(accessRoleId);
      if (input.tenantId && accessRole.tenantId !== input.tenantId) {
        throw new AppError("Role does not belong to this tenant", 400);
      }
      role = accessRole.name;
    }

    const { data: user, error } = await supabase
      .from(USERS)
      .insert({
        id,
        name,
        email,
        password_hash: passwordHash,
        role,
        initials,
        status: "Active",
        is_super_admin: false,
        employee_id: input.employeeId ?? null,
        tenant_id: input.tenantId ?? null,
        access_role_id: accessRoleId,
      })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);

    if (input.tenantId) {
      const { error: linkErr } = await supabase.from("tenant_users").upsert(
        {
          tenant_id: input.tenantId,
          user_id: id,
          role: "member",
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (linkErr) throw new AppError(linkErr.message, 500);
    }

    if (accessRoleId) {
      await UserAdminService.setUserAccess(id, {
        propertyIds,
        permissions: [],
        tenantId: input.tenantId,
      });
      await applyRolePermissionsToUser(id, accessRoleId, propertyIds);
    } else {
      await UserAdminService.setUserAccess(id, {
        propertyIds,
        permissions: input.permissions ?? [],
        tenantId: input.tenantId,
      });
    }

    const listed = await UserAdminService.listUsers();
    const created = listed.find((u) => u.id === id);
    if (!created) throw new AppError("Failed to load created user", 500);
    return created;
  },

  async setUserAccess(
    userId: string,
    input: {
      propertyIds: string[];
      permissions: Array<{
        propertyId: string;
        moduleKey: string;
        permission: PermissionLevel;
      }>;
      tenantId?: string;
    },
  ): Promise<void> {
    invalidateModuleAccessCache(userId);
    await supabase.from(ACCESS).delete().eq("user_id", userId);
    await supabase.from(PERMS).delete().eq("user_id", userId);

    const propertyIds = [...new Set(input.propertyIds.filter(Boolean))];
    if (input.tenantId && propertyIds.length) {
      await assertPropertiesBelongToTenant(propertyIds, input.tenantId);
    }
    // Permissions must also stay inside assigned properties
    const allowed = new Set(propertyIds);
    const safePermissions = input.permissions.filter((p) => allowed.has(p.propertyId));

    if (propertyIds.length) {
      const accessRows = propertyIds.map((propertyId, idx) => ({
        user_id: userId,
        property_id: propertyId,
        is_default: idx === 0,
      }));
      const { error } = await supabase.from(ACCESS).insert(accessRows);
      if (error) throw new AppError(error.message, 500);
    }

    const permRows = safePermissions
      .map((p) => ({
        ...p,
        permission: (p.permission === "admin" ? "write" : p.permission) as PermissionLevel,
      }))
      .filter((p) => PLATFORM_PAGE_KEYS.has(p.moduleKey) && (p.permission === "read" || p.permission === "write"))
      .map((p) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        property_id: p.propertyId,
        module_key: p.moduleKey,
        permission: p.permission,
      }));

    if (permRows.length) {
      const { error } = await supabase.from(PERMS).insert(permRows);
      if (error) throw new AppError(error.message, 500);
    }
  },

  async updateUser(
    userId: string,
    patch: {
      name?: string;
      role?: string;
      status?: string;
      isSuperAdmin?: boolean;
      propertyIds?: string[];
      permissions?: Array<{
        propertyId: string;
        moduleKey: string;
        permission: PermissionLevel;
      }>;
      employeeId?: string | null;
      password?: string;
      accessRoleId?: string | null;
    },
  ): Promise<ManagedUser> {
    const existing = (await UserAdminService.listUsers()).find((u) => u.id === userId);
    if (!existing) throw new NotFoundError("User not found");

    const nextPropertyIds = patch.propertyIds ?? existing.propertyIds;
    if (patch.employeeId !== undefined) {
      await assertEmployeeLink({
        employeeId: patch.employeeId,
        propertyIds: nextPropertyIds,
      });
    }

    const body: Record<string, unknown> = {};
    if (patch.name != null) body.name = patch.name.trim();
    if (patch.role != null) body.role = patch.role.trim();
    if (patch.status != null) body.status = patch.status;
    if (patch.isSuperAdmin) {
      throw new AppError("Super Admin cannot be assigned from PMS user management", 400);
    }
    if (existing.isSuperAdmin) {
      throw new AppError("Super Admin accounts cannot be edited from PMS", 400);
    }
    const existingRole = String(existing.role ?? "").trim().toLowerCase();
    if (existingRole === "admin" || existingRole === "administrator") {
      throw new AppError("Tenant Admin accounts cannot be edited from User management", 400);
    }
    if (patch.role != null && /^super\s*admin$/i.test(patch.role.trim())) {
      throw new AppError("Super Admin is reserved for the SaaS product owner", 400);
    }
    if (patch.role != null && /^(admin|administrator)$/i.test(patch.role.trim())) {
      throw new AppError("Admin is the tenant owner account and cannot be assigned from User management", 400);
    }
    if (patch.isSuperAdmin === false) body.is_super_admin = false;
    if (patch.employeeId !== undefined) body.employee_id = patch.employeeId;
    if (patch.password) {
      if (patch.password.length < 6) throw new AppError("Password must be at least 6 characters", 400);
      body.password_hash = await bcrypt.hash(patch.password, 10);
    }

    const nextAccessRoleId =
      patch.accessRoleId !== undefined ? patch.accessRoleId : existing.accessRoleId ?? null;
    if (patch.accessRoleId !== undefined) {
      if (patch.accessRoleId) {
        const accessRole = await RoleService.get(patch.accessRoleId);
        if (existing.tenantId && accessRole.tenantId !== existing.tenantId) {
          throw new AppError("Role does not belong to this tenant", 400);
        }
        body.access_role_id = patch.accessRoleId;
        body.role = accessRole.name;
      } else {
        body.access_role_id = null;
      }
    }

    if (Object.keys(body).length) {
      const { error } = await supabase.from(USERS).update(body).eq("id", userId);
      if (error) throw new AppError(error.message, 500);
      invalidateModuleAccessCache(userId);
    }

    const roleChanged = patch.accessRoleId !== undefined;
    const propsChanged = Boolean(patch.propertyIds);
    const permsChanged = Boolean(patch.permissions);

    if (nextAccessRoleId && (roleChanged || propsChanged)) {
      await UserAdminService.setUserAccess(userId, {
        propertyIds: nextPropertyIds,
        permissions: [],
        tenantId: existing.tenantId ?? undefined,
      });
      await applyRolePermissionsToUser(userId, nextAccessRoleId, nextPropertyIds);
    } else if (propsChanged || permsChanged) {
      await UserAdminService.setUserAccess(userId, {
        propertyIds: nextPropertyIds,
        permissions: patch.permissions ?? existing.permissions,
        tenantId: existing.tenantId ?? undefined,
      });
    }

    const listed = await UserAdminService.listUsers();
    const updated = listed.find((u) => u.id === userId);
    if (!updated) throw new NotFoundError("User not found");
    return updated;
  },

  async getMyPermissions(
    userId: string,
    propertyId: string,
    isSuperAdmin?: boolean,
    role?: string,
  ): Promise<Record<string, PermissionLevel | "admin">> {
    if (isPlatformAdmin({ isSuperAdmin, role: role ?? "" })) {
      return Object.fromEntries([
        ...PLATFORM_MODULES.map((m) => [m.key, "admin" as const]),
        ...LEGACY_MODULE_KEYS.map((k) => [k, "admin" as const]),
      ]);
    }
    const { data, error } = await supabase
      .from(PERMS)
      .select("*")
      .eq("user_id", userId)
      .eq("property_id", propertyId);
    if (error) throw new AppError(error.message, 500);
    const map: Record<string, PermissionLevel> = {};
    for (const row of data ?? []) {
      map[String(row.module_key)] = row.permission as PermissionLevel;
    }
    return map;
  },

  /** True if the user has at least read on this page key for any property. */
  async userHasPageGrant(userId: string, pageKey: string): Promise<boolean> {
    const { data, error } = await supabase
      .from(PERMS)
      .select("id")
      .eq("user_id", userId)
      .eq("module_key", pageKey)
      .in("permission", ["read", "write", "admin"])
      .limit(1);
    if (error) throw new AppError(error.message, 500);
    return (data?.length ?? 0) > 0;
  },
};

export type { UserPropertyAccessRow };

import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { PLATFORM_PAGE_KEYS, type PermissionLevel } from "../../types/platform.js";
import { invalidateModuleAccessCache } from "../../middleware/module-access.js";

const ROLES = "tenant_roles";
const ROLE_PERMS = "tenant_role_permissions";
const USERS = "users";
const USER_PERMS = "user_permissions";
const ACCESS = "user_property_access";

export type RolePermission = {
  moduleKey: string;
  permission: PermissionLevel;
};

export type ManagedRole = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
  userCount: number;
  createdAt?: string;
  updatedAt?: string;
};

function newRoleId() {
  return `ROLE-${Date.now().toString(36).toUpperCase()}`;
}

async function loadRole(id: string): Promise<ManagedRole | null> {
  const { data, error } = await supabase.from(ROLES).select("*").eq("id", id).maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) return null;

  const { data: perms, error: permErr } = await supabase
    .from(ROLE_PERMS)
    .select("*")
    .eq("role_id", id);
  if (permErr) throw new AppError(permErr.message, 500);

  const { count, error: countErr } = await supabase
    .from(USERS)
    .select("id", { count: "exact", head: true })
    .eq("access_role_id", id);
  if (countErr) throw new AppError(countErr.message, 500);

  const row = toCamel<{
    id: string;
    tenantId: string;
    name: string;
    description: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
  }>(data);

  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? "",
    status: row.status ?? "Active",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    permissions: (perms ?? []).map((p) => ({
      moduleKey: String(p.module_key),
      permission: p.permission as PermissionLevel,
    })),
    userCount: count ?? 0,
  };
}

async function replaceRolePermissions(roleId: string, permissions: RolePermission[]) {
  const { error: delErr } = await supabase.from(ROLE_PERMS).delete().eq("role_id", roleId);
  if (delErr) throw new AppError(delErr.message, 500);

  const rows = permissions
    .map((p) => ({
      ...p,
      // Staff roles: read or write only (legacy admin → write)
      permission: (p.permission === "admin" ? "write" : p.permission) as PermissionLevel,
    }))
    .filter((p) => PLATFORM_PAGE_KEYS.has(p.moduleKey) && (p.permission === "read" || p.permission === "write"))
    .map((p) => ({
      role_id: roleId,
      module_key: p.moduleKey,
      permission: p.permission,
    }));

  if (!rows.length) return;
  const { error } = await supabase.from(ROLE_PERMS).insert(rows);
  if (error) throw new AppError(error.message, 500);
}

/** Apply a role's page grants onto a user's assigned properties. */
export async function applyRolePermissionsToUser(
  userId: string,
  roleId: string,
  propertyIds: string[],
) {
  const role = await loadRole(roleId);
  if (!role) throw new NotFoundError("Role not found");

  const { error: delErr } = await supabase.from(USER_PERMS).delete().eq("user_id", userId);
  if (delErr) throw new AppError(delErr.message, 500);

  const permRows = propertyIds.flatMap((propertyId) =>
    role.permissions.map((p) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      property_id: propertyId,
      module_key: p.moduleKey,
      permission: p.permission,
    })),
  );

  if (permRows.length) {
    const { error } = await supabase.from(USER_PERMS).insert(permRows);
    if (error) throw new AppError(error.message, 500);
  }

  invalidateModuleAccessCache(userId);
}

async function reapplyRoleToAssignedUsers(roleId: string) {
  const { data: users, error } = await supabase
    .from(USERS)
    .select("id")
    .eq("access_role_id", roleId);
  if (error) throw new AppError(error.message, 500);

  for (const u of users ?? []) {
    const userId = String(u.id);
    const { data: access } = await supabase.from(ACCESS).select("property_id").eq("user_id", userId);
    const propertyIds = (access ?? []).map((a) => String(a.property_id));
    await applyRolePermissionsToUser(userId, roleId, propertyIds);
  }
}

export const RoleService = {
  async listForTenant(tenantId: string): Promise<ManagedRole[]> {
    const { data, error } = await supabase
      .from(ROLES)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error) throw new AppError(error.message, 500);

    const roles: ManagedRole[] = [];
    for (const row of data ?? []) {
      const full = await loadRole(String(row.id));
      if (full) roles.push(full);
    }
    return roles;
  },

  async get(id: string): Promise<ManagedRole> {
    const role = await loadRole(id);
    if (!role) throw new NotFoundError("Role not found");
    return role;
  },

  async create(input: {
    tenantId: string;
    name: string;
    description?: string;
    permissions?: RolePermission[];
  }): Promise<ManagedRole> {
    const name = input.name.trim();
    if (!name) throw new AppError("Role name is required", 400);
    if (!input.tenantId) throw new AppError("Tenant is required", 400);

    const id = newRoleId();
    const { error } = await supabase.from(ROLES).insert({
      id,
      tenant_id: input.tenantId,
      name,
      description: (input.description ?? "").trim(),
      status: "Active",
    });
    if (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        throw new AppError("A role with this name already exists", 400);
      }
      throw new AppError(error.message, 500);
    }

    await replaceRolePermissions(id, input.permissions ?? []);
    return RoleService.get(id);
  },

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      status?: string;
      permissions?: RolePermission[];
      reapplyToUsers?: boolean;
    },
  ): Promise<ManagedRole> {
    const existing = await RoleService.get(id);
    const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name != null) {
      const name = patch.name.trim();
      if (!name) throw new AppError("Role name is required", 400);
      body.name = name;
    }
    if (patch.description != null) body.description = patch.description.trim();
    if (patch.status != null) body.status = patch.status;

    if (Object.keys(body).length > 1) {
      const { error } = await supabase.from(ROLES).update(body).eq("id", id);
      if (error) {
        if (String(error.message).toLowerCase().includes("unique")) {
          throw new AppError("A role with this name already exists", 400);
        }
        throw new AppError(error.message, 500);
      }
    }

    if (patch.permissions) {
      await replaceRolePermissions(id, patch.permissions);
      if (patch.reapplyToUsers !== false) {
        await reapplyRoleToAssignedUsers(id);
      }
    }

    // Keep users.role label in sync with role name
    if (patch.name != null && patch.name.trim() !== existing.name) {
      await supabase.from(USERS).update({ role: patch.name.trim() }).eq("access_role_id", id);
    }

    return RoleService.get(id);
  },

  async remove(id: string): Promise<void> {
    await RoleService.get(id);
    const { count, error: countErr } = await supabase
      .from(USERS)
      .select("id", { count: "exact", head: true })
      .eq("access_role_id", id);
    if (countErr) throw new AppError(countErr.message, 500);
    if ((count ?? 0) > 0) {
      throw new AppError("Unassign this role from all users before deleting it", 400);
    }
    const { error } = await supabase.from(ROLES).delete().eq("id", id);
    if (error) throw new AppError(error.message, 500);
  },
};

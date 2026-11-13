import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError, PermissionError } from "../../errors/index.js";
import {
  getScopedTenantIdsForUser,
  userBelongsToPropertyTenant,
} from "../../utils/tenant-isolation.js";
import type {
  PermissionLevel,
  PropertyRow,
  UserPermissionRow,
  UserPropertyAccessRow,
} from "../../types/platform.js";

const PROPERTIES = "properties";
const ACCESS = "user_property_access";
const PERMS = "user_permissions";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function isTenantAdminRole(role?: string) {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "admin" || r === "administrator";
}

export const PropertyService = {
  async userCanAccessProperty(
    userId: string,
    propertyId: string,
    isSuperAdmin?: boolean,
    role?: string,
  ): Promise<boolean> {
    // Only true platform super-admins bypass access rows.
    if (isSuperAdmin) {
      const tenantOk = await userBelongsToPropertyTenant(userId, propertyId, true);
      return tenantOk;
    }

    const sameTenant = await userBelongsToPropertyTenant(userId, propertyId, false);
    if (!sameTenant) return false;

    const { data, error } = await supabase
      .from(ACCESS)
      .select("property_id")
      .eq("user_id", userId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (data) return true;

    // Tenant Admins (users.role = Admin) may open any property under their home/scoped tenant.
    // Regular Users must have an explicit user_property_access row.
    if (!isTenantAdminRole(role)) return false;

    const scopedTenantIds = await getScopedTenantIdsForUser(userId);
    if (!scopedTenantIds.length) return false;

    const { data: prop } = await supabase
      .from(PROPERTIES)
      .select("tenant_id")
      .eq("id", propertyId)
      .maybeSingle();
    const propertyTenantId = prop?.tenant_id ? String(prop.tenant_id) : "";
    if (!propertyTenantId || !scopedTenantIds.includes(propertyTenantId)) {
      return false;
    }
    const { data: adminLink } = await supabase
      .from("tenant_users")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", propertyTenantId)
      .eq("role", "admin")
      .maybeSingle();
    return Boolean(adminLink);
  },

  async listForUser(
    userId: string,
    isSuperAdmin?: boolean,
    role?: string,
  ): Promise<PropertyRow[]> {
    // Platform super-admin only: all properties (support). Tenant Admins never hit this.
    if (isSuperAdmin) {
      const { data, error } = await supabase
        .from(PROPERTIES)
        .select("*")
        .eq("status", "Active")
        .order("name");
      if (error) throw new AppError(error.message, 500);
      return toCamel<PropertyRow[]>(data ?? []);
    }

    // Home-tenant scoped (ignores leftover tenant-default memberships from old seeds).
    const tenantIds = await getScopedTenantIdsForUser(userId);
    if (!tenantIds.length) return [];

    const { data: links, error: linkErr } = await supabase
      .from(ACCESS)
      .select("property_id, is_default")
      .eq("user_id", userId);
    if (linkErr) throw new AppError(linkErr.message, 500);

    // Tenant Admin → all properties in their home tenant only.
    // Staff → only assigned properties that also belong to that tenant.
    const showWholeTenant = isTenantAdminRole(role);

    let query = supabase
      .from(PROPERTIES)
      .select("*")
      .in("tenant_id", tenantIds)
      .eq("status", "Active")
      .order("name");

    if (!showWholeTenant) {
      const ids = (links ?? []).map((l) => String(l.property_id));
      if (!ids.length) return [];
      query = query.in("id", ids);
    }

    const { data, error } = await query;
    if (error) throw new AppError(error.message, 500);

    const defaultId =
      links?.find((l) => l.is_default)?.property_id ?? links?.[0]?.property_id;
    return toCamel<PropertyRow[]>(data ?? []).map((p) => ({
      ...p,
      isDefault: defaultId ? String(p.id) === String(defaultId) : false,
    }));
  },

  async create(input: {
    name: string;
    code: string;
    city?: string;
    timezone?: string;
    isDefault?: boolean;
    tenantId: string;
    ownerUserId?: string;
  }): Promise<PropertyRow> {
    const name = input.name.trim();
    const code = input.code.trim().toLowerCase();
    const tenantId = input.tenantId.trim();
    if (!name || !code) throw new AppError("Name and code are required", 400);
    if (!tenantId) throw new AppError("Tenant is required", 400);

    const { TenantService } = await import("../saas/tenant.service.js");
    await TenantService.assertCanCreateProperty(tenantId);

    const id = `prop-${code}`;
    const { data, error } = await supabase
      .from(PROPERTIES)
      .insert({
        id,
        name,
        code,
        city: input.city?.trim() ?? "",
        timezone: input.timezone ?? "Asia/Kolkata",
        is_default: Boolean(input.isDefault),
        status: "Active",
        tenant_id: tenantId,
      })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);

    if (input.ownerUserId) {
      await supabase.from(ACCESS).upsert(
        {
          user_id: input.ownerUserId,
          property_id: id,
          is_default: true,
        },
        { onConflict: "user_id,property_id" },
      );

      // Tenant owner needs full module access on the new property.
      const { PLATFORM_MODULES } = await import("../../types/platform.js");
      const permRows = PLATFORM_MODULES.map((m) => ({
        id: crypto.randomUUID(),
        user_id: input.ownerUserId,
        property_id: id,
        module_key: m.key,
        permission: "admin",
      }));
      await supabase.from(PERMS).delete().eq("user_id", input.ownerUserId).eq("property_id", id);
      if (permRows.length) {
        const { error: permErr } = await supabase.from(PERMS).insert(permRows);
        if (permErr) throw new AppError(permErr.message, 500);
      }
    }

    const accountsSetup = await this.seedAccounts(id);
    return { ...toCamel<PropertyRow>(data), accountsSetup } as PropertyRow;
  },

  /**
   * Basic Accounts masters for a new property (backend/sql/accounts-property-setup.sql).
   * Never blocks property creation: the result says whether it ran.
   */
  async seedAccounts(propertyId: string): Promise<{ seeded: boolean; message: string }> {
    const { data, error } = await supabase.rpc("acc_seed_property", { p_property_id: propertyId });
    if (error) {
      console.warn(`[accounts] basic setup for ${propertyId} failed: ${error.message}`);
      return {
        seeded: false,
        message: /acc_seed_property/i.test(error.message)
          ? "Run backend/sql/accounts-property-setup.sql in Supabase, then re-run it to set up this property's Accounts."
          : error.message,
      };
    }
    const res = (data ?? {}) as { seeded?: boolean; reason?: string };
    return { seeded: Boolean(res.seeded), message: res.seeded ? "Accounts basic setup created" : res.reason ?? "" };
  },

  async update(
    id: string,
    patch: Partial<Pick<PropertyRow, "name" | "code" | "city" | "timezone" | "status">>,
  ): Promise<PropertyRow> {
    const body: Record<string, unknown> = {};
    if (patch.name != null) body.name = patch.name.trim();
    if (patch.code != null) body.code = patch.code.trim().toLowerCase();
    if (patch.city != null) body.city = patch.city.trim();
    if (patch.timezone != null) body.timezone = patch.timezone;
    if (patch.status != null) body.status = patch.status;
    body.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from(PROPERTIES)
      .update(body)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new NotFoundError("Property not found");
    return toCamel<PropertyRow>(data);
  },

  /**
   * Delete property and all rows keyed by property_id across modules.
   * Prefers SQL function delete_property_cascade (run property-delete-cascade.sql).
   */
  async delete(id: string): Promise<{ id: string; report: Record<string, unknown> }> {
    const propertyId = id.trim();
    if (!propertyId) throw new AppError("Property id is required", 400);

    const { data: existing, error: findErr } = await supabase
      .from(PROPERTIES)
      .select("id, name")
      .eq("id", propertyId)
      .maybeSingle();
    if (findErr) throw new AppError(findErr.message, 500);
    if (!existing) throw new NotFoundError("Property not found");

    const { data, error } = await supabase.rpc("delete_property_cascade", {
      p_property_id: propertyId,
    });

    if (error) {
      if (/delete_property_cascade/i.test(error.message)) {
        throw new AppError(
          "Run backend/sql/property-delete-cascade.sql in Supabase, then retry deleting the property.",
          500,
          "SCHEMA_MISSING",
        );
      }
      throw new AppError(error.message, 500);
    }

    return {
      id: propertyId,
      report: (data ?? {}) as Record<string, unknown>,
    };
  },

  async getUserPermissions(
    userId: string,
    propertyId: string,
  ): Promise<UserPermissionRow[]> {
    const { data, error } = await supabase
      .from(PERMS)
      .select("*")
      .eq("user_id", userId)
      .eq("property_id", propertyId);
    if (error) throw new AppError(error.message, 500);
    return toCamel<UserPermissionRow[]>(data ?? []);
  },

  async userHasModulePermission(
    userId: string,
    propertyId: string,
    moduleKey: string,
    level: "read" | "write",
    isSuperAdmin?: boolean,
  ): Promise<boolean> {
    if (isSuperAdmin) return true;
    const perms = await this.getUserPermissions(userId, propertyId);
    const row = perms.find((p) => p.moduleKey === moduleKey);
    if (!row) return false;
    if (level === "read") return ["read", "write", "admin"].includes(row.permission);
    return ["write", "admin"].includes(row.permission);
  },

  assertModulePermission(
    userId: string,
    propertyId: string,
    moduleKey: string,
    level: "read" | "write",
    isSuperAdmin?: boolean,
  ) {
    void userId;
    void propertyId;
    void moduleKey;
    void level;
    void isSuperAdmin;
    // Enforced on frontend for now; hook for future route-level RBAC.
  },

  initialsFromPropertyName: initialsFromName,
};

export type { UserPropertyAccessRow, UserPermissionRow };

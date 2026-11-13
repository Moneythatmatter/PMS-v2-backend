import bcrypt from "bcryptjs";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import {
  AppError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from "../../errors/index.js";
import type { TenantRow, TenantWithAdmin } from "../../types/saas.js";

const TENANTS = "tenants";
const TENANT_USERS = "tenant_users";
const USERS = "users";
const PROPERTIES = "properties";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "TA";
}

export const TenantService = {
  async listTenants(): Promise<TenantWithAdmin[]> {
    const { data, error } = await supabase
      .from(TENANTS)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new AppError(error.message, 500);

    const tenants = toCamel<TenantRow[]>(data ?? []);
    const result: TenantWithAdmin[] = [];

    for (const tenant of tenants) {
      const { data: links } = await supabase
        .from(TENANT_USERS)
        .select("user_id, role")
        .eq("tenant_id", tenant.id);

      const adminLink =
        (links ?? []).find((l) => String(l.role) === "admin") ?? (links ?? [])[0];

      let adminName: string | undefined;
      let adminEmail: string | undefined;
      let adminUserId: string | undefined;
      if (adminLink) {
        adminUserId = String(adminLink.user_id);
        const { data: user } = await supabase
          .from(USERS)
          .select("id, name, email")
          .eq("id", adminUserId)
          .maybeSingle();
        if (user) {
          adminName = String(user.name);
          adminEmail = String(user.email);
        }
      }

      const { count: propertyCount } = await supabase
        .from(PROPERTIES)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id);

      result.push({
        ...tenant,
        adminUserId,
        adminName,
        adminEmail,
        propertyCount: propertyCount ?? 0,
        userCount: (links ?? []).length,
      });
    }

    return result;
  },

  async getTenant(id: string): Promise<TenantWithAdmin> {
    const rows = await this.listTenants();
    const row = rows.find((t) => t.id === id);
    if (!row) throw new NotFoundError("Tenant not found");
    return row;
  },

  async createTenant(input: {
    name: string;
    slug?: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }): Promise<TenantWithAdmin> {
    const name = input.name.trim();
    const adminName = input.adminName.trim();
    const adminEmail = input.adminEmail.trim().toLowerCase();
    const slug = slugify(input.slug?.trim() || name);

    if (!name) throw new ValidationError("Tenant name is required");
    if (!slug) throw new ValidationError("Tenant slug is required");
    if (!adminName || !adminEmail || !input.adminPassword) {
      throw new ValidationError("Admin name, email, and password are required");
    }
    if (input.adminPassword.length < 6) {
      throw new ValidationError("Password must be at least 6 characters");
    }

    const { data: existingSlug } = await supabase
      .from(TENANTS)
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingSlug) throw new ValidationError("Tenant slug already exists");

    const { data: existingEmail } = await supabase
      .from(USERS)
      .select("id")
      .eq("email", adminEmail)
      .maybeSingle();
    if (existingEmail) throw new ValidationError("Admin email is already registered");

    const tenantId = `tenant-${slug}`;
    const { data: tenant, error: tenantErr } = await supabase
      .from(TENANTS)
      .insert({
        id: tenantId,
        name,
        slug,
        status: "Active",
      })
      .select()
      .single();
    if (tenantErr) throw new AppError(tenantErr.message, 500);

    const userId = `U-${Date.now().toString(36).toUpperCase()}`;
    const passwordHash = await bcrypt.hash(input.adminPassword, 10);
    const { error: userErr } = await supabase.from(USERS).insert({
      id: userId,
      name: adminName,
      email: adminEmail,
      password_hash: passwordHash,
      role: "Admin", // Tenant Admin (never Super Admin)
      initials: initialsFromName(adminName),
      status: "Active",
      is_super_admin: false,
      tenant_id: tenantId,
    });
    if (userErr) {
      await supabase.from(TENANTS).delete().eq("id", tenantId);
      throw new AppError(userErr.message, 500);
    }

    const { error: linkErr } = await supabase.from(TENANT_USERS).insert({
      tenant_id: tenantId,
      user_id: userId,
      role: "admin",
    });
    if (linkErr) {
      await supabase.from(USERS).delete().eq("id", userId);
      await supabase.from(TENANTS).delete().eq("id", tenantId);
      throw new AppError(linkErr.message, 500);
    }

    void tenant;
    return this.getTenant(tenantId);
  },

  async updateTenantStatus(id: string, status: string): Promise<TenantWithAdmin> {
    const next = status.trim();
    if (!["Active", "Inactive"].includes(next)) {
      throw new ValidationError("Status must be Active or Inactive");
    }
    const { data, error } = await supabase
      .from(TENANTS)
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new NotFoundError("Tenant not found");
    return this.getTenant(id);
  },

  async getTenantIdsForUser(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from(TENANT_USERS)
      .select("tenant_id")
      .eq("user_id", userId);
    if (error) throw new AppError(error.message, 500);
    return (data ?? []).map((r) => String(r.tenant_id));
  },

  async getPrimaryTenantId(userId: string): Promise<string | null> {
    const ids = await this.getTenantIdsForUser(userId);
    if (!ids.length) return null;

    const { data } = await supabase
      .from(TENANTS)
      .select("id")
      .in("id", ids)
      .eq("status", "Active")
      .order("created_at", { ascending: true })
      .limit(1);
    return data?.[0] ? String(data[0].id) : null;
  },

  /** All user ids linked to a tenant via tenant_users. */
  async listUserIdsForTenant(tenantId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from(TENANT_USERS)
      .select("user_id")
      .eq("tenant_id", tenantId);
    if (error) throw new AppError(error.message, 500);
    return (data ?? []).map((r) => String(r.user_id));
  },

  async isTenantAdmin(userId: string, tenantId?: string): Promise<boolean> {
    const { data: user, error: userErr } = await supabase
      .from(USERS)
      .select("role, is_super_admin")
      .eq("id", userId)
      .maybeSingle();
    if (userErr) throw new AppError(userErr.message, 500);
    if (!user || user.is_super_admin) return false;
    const role = String(user.role ?? "").trim().toLowerCase();
    if (role !== "admin" && role !== "administrator") return false;

    let query = supabase
      .from(TENANT_USERS)
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query.limit(1);
    if (error) throw new AppError(error.message, 500);
    return Boolean(data?.length);
  },

  async assertUserCanUsePms(userId: string, isSuperAdmin?: boolean) {
    if (isSuperAdmin) return;

    const tenantIds = await this.getTenantIdsForUser(userId);
    if (!tenantIds.length) {
      throw new PermissionError(
        "No tenant access. Contact your platform administrator.",
      );
    }

    const { data: active } = await supabase
      .from(TENANTS)
      .select("id")
      .in("id", tenantIds)
      .eq("status", "Active")
      .limit(1);
    if (!active?.length) {
      throw new PermissionError("Your tenant account is inactive.");
    }
  },

  async resolveTenantIdForProperty(propertyId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from(PROPERTIES)
      .select("tenant_id")
      .eq("id", propertyId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    return data?.tenant_id ? String(data.tenant_id) : null;
  },
};

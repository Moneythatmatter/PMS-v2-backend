import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError, PermissionError } from "../../errors/index.js";
import { isPlatformAdmin } from "../../utils/platform-admin.js";
import type {
  PermissionLevel,
  PropertyRow,
  UserPermissionRow,
} from "../../types/platform.js";

const PROPERTIES = "properties";
const ACCESS = "user_property_access";
const PERMS = "user_permissions";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const PropertyService = {
  async userCanAccessProperty(
    userId: string,
    propertyId: string,
    isSuperAdmin?: boolean,
    role?: string,
  ): Promise<boolean> {
    if (isPlatformAdmin({ isSuperAdmin, role })) return true;
    const { data, error } = await supabase
      .from(ACCESS)
      .select("property_id")
      .eq("user_id", userId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    return Boolean(data);
  },

  async listForUser(
    userId: string,
    isSuperAdmin?: boolean,
    role?: string,
  ): Promise<PropertyRow[]> {
    if (isPlatformAdmin({ isSuperAdmin, role })) {
      const { data, error } = await supabase
        .from(PROPERTIES)
        .select("*")
        .eq("status", "Active")
        .order("name");
      if (error) throw new AppError(error.message, 500);
      return toCamel<PropertyRow[]>(data ?? []);
    }

    const { data: links, error: linkErr } = await supabase
      .from(ACCESS)
      .select("property_id, is_default")
      .eq("user_id", userId);
    if (linkErr) throw new AppError(linkErr.message, 500);
    if (!links?.length) return [];

    const ids = links.map((l) => String(l.property_id));
    const { data, error } = await supabase
      .from(PROPERTIES)
      .select("*")
      .in("id", ids)
      .eq("status", "Active")
      .order("name");
    if (error) throw new AppError(error.message, 500);

    const defaultId =
      links.find((l) => l.is_default)?.property_id ?? links[0]?.property_id;
    return toCamel<PropertyRow[]>(data ?? []).map((p) => ({
      ...p,
      isDefault: String(p.id) === String(defaultId),
    }));
  },

  async create(input: {
    name: string;
    code: string;
    city?: string;
    timezone?: string;
    isDefault?: boolean;
  }): Promise<PropertyRow> {
    const name = input.name.trim();
    const code = input.code.trim().toLowerCase();
    if (!name || !code) throw new AppError("Name and code are required", 400);

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
      })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return toCamel<PropertyRow>(data);
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

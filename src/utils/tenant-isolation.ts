import { supabase } from "./supabase.js";
import { AppError, PermissionError } from "../errors/index.js";

/**
 * Strict tenant isolation helpers for PMS.
 * Platform super-admins may cross tenants; everyone else is locked to their tenant_users memberships.
 */

export async function getActiveTenantIdsForUser(userId: string): Promise<string[]> {
  const { data: links, error: linkErr } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", userId);
  if (linkErr) throw new AppError(linkErr.message, 500);
  const ids = (links ?? []).map((r) => String(r.tenant_id));
  if (!ids.length) return [];

  const { data: active, error: tErr } = await supabase
    .from("tenants")
    .select("id")
    .in("id", ids)
    .eq("status", "Active");
  if (tErr) throw new AppError(tErr.message, 500);
  return (active ?? []).map((r) => String(r.id));
}

export async function getPropertyTenantId(propertyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("properties")
    .select("tenant_id, status")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data || String(data.status) !== "Active") return null;
  return data.tenant_id ? String(data.tenant_id) : null;
}

/** True when the user may open this property under tenant isolation rules. */
export async function userBelongsToPropertyTenant(
  userId: string,
  propertyId: string,
  isSuperAdmin?: boolean,
): Promise<boolean> {
  if (isSuperAdmin) return true;
  const propertyTenantId = await getPropertyTenantId(propertyId);
  if (!propertyTenantId) return false;
  const tenantIds = await getActiveTenantIdsForUser(userId);
  return tenantIds.includes(propertyTenantId);
}

export async function assertPropertiesBelongToTenant(
  propertyIds: string[],
  tenantId: string,
) {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  if (!ids.length) return;
  const { data, error } = await supabase
    .from("properties")
    .select("id, tenant_id")
    .in("id", ids);
  if (error) throw new AppError(error.message, 500);
  const found = new Map((data ?? []).map((r) => [String(r.id), String(r.tenant_id ?? "")]));
  for (const id of ids) {
    const tid = found.get(id);
    if (!tid) throw new AppError(`Property not found: ${id}`, 400);
    if (tid !== tenantId) {
      throw new PermissionError("Cannot assign a property from another tenant");
    }
  }
}

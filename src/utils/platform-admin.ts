import type { AuthedRequest } from "../middleware/auth.js";

/**
 * Can manage properties / users in PMS.
 * - Super Admin (flag or role) = platform
 * - Admin / Administrator = tenant admin
 */
export function isPlatformAdmin(
  auth?: Pick<NonNullable<AuthedRequest["auth"]>, "isSuperAdmin" | "role"> | null,
): boolean {
  if (!auth) return false;
  if (auth.isSuperAdmin) return true;
  const role = String(auth.role ?? "").trim().toLowerCase();
  return (
    role === "super admin" ||
    role === "superadmin" ||
    role === "admin" ||
    role === "administrator"
  );
}

/** True platform console operator only. */
export function isSuperAdminRole(
  auth?: Pick<NonNullable<AuthedRequest["auth"]>, "isSuperAdmin" | "role"> | null,
): boolean {
  if (!auth) return false;
  if (auth.isSuperAdmin) return true;
  const role = String(auth.role ?? "").trim().toLowerCase();
  return role === "super admin" || role === "superadmin";
}

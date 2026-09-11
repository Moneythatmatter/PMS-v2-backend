import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { enrichEmployee } from "../human-resources/enrich.js";
import { AppError, NotFoundError, PermissionError } from "../../errors/index.js";
import type { AuthUserRow, EmployeePortalContext } from "../../types/auth.js";
import { PropertyService } from "../platform/property.service.js";

const USERS_TABLE = "users";
const PROPERTIES_TABLE = "properties";

export type ResolvedEmployeeContext = {
  user: AuthUserRow;
  employeeId: string;
  propertyId: string;
  employee: EmployeePortalContext;
};

async function loadUserRow(userId: string): Promise<AuthUserRow | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) return null;
  return toCamel<AuthUserRow>(data);
}

async function propertyName(propertyId: string): Promise<string | undefined> {
  const { data, error } = await supabase
    .from(PROPERTIES_TABLE)
    .select("name")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  return data?.name ? String(data.name) : undefined;
}

export async function buildEmployeePortalContext(
  employeeId: string,
): Promise<EmployeePortalContext | null> {
  const emp = await hrModel.get<{
    id: string;
    propertyId: string;
    empCode: string;
    firstName: string;
    lastName: string;
    status: string;
    leaveBalance?: { casual?: number; sick?: number; earned?: number };
  }>(hrTables.employees, employeeId);
  if (!emp || emp.status !== "Active") return null;

  const enriched = await enrichEmployee(emp as unknown as Parameters<typeof enrichEmployee>[0]);
  const propName = await propertyName(emp.propertyId);

  return {
    employeeId: emp.id,
    empCode: emp.empCode,
    propertyId: emp.propertyId,
    propertyName: propName,
    firstName: emp.firstName,
    lastName: emp.lastName,
    department: enriched.department,
    designation: enriched.designation,
    leaveBalance: emp.leaveBalance,
  };
}

export async function resolveEmployeeContextForUser(
  userId: string,
  opts?: { isSuperAdmin?: boolean; role?: string },
): Promise<ResolvedEmployeeContext> {
  const user = await loadUserRow(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!user.employeeId) {
    throw new PermissionError("No employee profile linked to this account");
  }

  const employee = await buildEmployeePortalContext(user.employeeId);
  if (!employee) {
    throw new PermissionError("Linked employee profile is inactive or missing");
  }

  const canAccess = await PropertyService.userCanAccessProperty(
    userId,
    employee.propertyId,
    opts?.isSuperAdmin,
    opts?.role,
  );
  if (!canAccess) {
    throw new PermissionError("You do not have access to this employee property");
  }

  return {
    user,
    employeeId: employee.employeeId,
    propertyId: employee.propertyId,
    employee,
  };
}

export function assertOwnEmployeeRecord(
  record: { employeeId?: string | null; propertyId?: string | null },
  ctx: { employeeId: string; propertyId: string },
) {
  if (record.propertyId && record.propertyId !== ctx.propertyId) {
    throw new PermissionError("Resource not found");
  }
  if (record.employeeId && record.employeeId !== ctx.employeeId) {
    throw new PermissionError("Resource not found");
  }
}

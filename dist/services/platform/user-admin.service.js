import bcrypt from "bcryptjs";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError, PermissionError } from "../../errors/index.js";
import { PLATFORM_MODULES } from "../../types/platform.js";
import { isPlatformAdmin } from "../../utils/platform-admin.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
const USERS = "users";
const ACCESS = "user_property_access";
const PERMS = "user_permissions";
function toPublic(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        initials: user.initials,
        isSuperAdmin: Boolean(user.isSuperAdmin),
        employeeId: user.employeeId ?? null,
    };
}
async function resolveEmployeeLabel(employeeId) {
    if (!employeeId)
        return undefined;
    const emp = await hrModel.get(hrTables.employees, employeeId);
    if (!emp)
        return undefined;
    return `${emp.empCode ?? employeeId} — ${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim();
}
async function assertEmployeeLink(input) {
    if (!input.employeeId)
        return;
    const emp = await hrModel.get(hrTables.employees, input.employeeId);
    if (!emp)
        throw new AppError("Selected employee record not found", 400);
    if (emp.status && emp.status !== "Active") {
        throw new AppError("Selected employee is not active", 400);
    }
    if (emp.propertyId && !input.propertyIds.includes(emp.propertyId)) {
        throw new AppError("Employee belongs to a property this user does not have access to", 400);
    }
}
export const UserAdminService = {
    assertSuperAdmin(isSuperAdmin, role) {
        if (!isPlatformAdmin({ isSuperAdmin, role: role ?? "" }))
            throw new PermissionError("Administrator access required");
    },
    async listUsers() {
        const { data: users, error } = await supabase.from(USERS).select("*").order("name");
        if (error)
            throw new AppError(error.message, 500);
        const rows = toCamel(users ?? []);
        const result = [];
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
            result.push({
                ...toPublic(user),
                status: user.status ?? "Active",
                propertyIds: (access ?? []).map((a) => String(a.property_id)),
                permissions: toCamel(perms ?? []),
                employeeLabel,
            });
        }
        return result;
    },
    async listEmployeeLinkOptions(propertyId) {
        const rows = await hrModel.list(hrTables.employees, {
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
    async createUser(input) {
        const email = input.email.trim().toLowerCase();
        const name = input.name.trim();
        if (!email || !name || !input.password) {
            throw new AppError("Name, email, and password are required", 400);
        }
        const id = `U-${Date.now().toString(36).toUpperCase()}`;
        const passwordHash = await bcrypt.hash(input.password, 10);
        const initials = input.initials?.trim() ||
            name
                .split(/\s+/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
        const propertyIds = input.propertyIds ?? [];
        await assertEmployeeLink({
            employeeId: input.employeeId,
            propertyIds,
        });
        const { data: user, error } = await supabase
            .from(USERS)
            .insert({
            id,
            name,
            email,
            password_hash: passwordHash,
            role: input.role?.trim() || "Staff",
            initials,
            status: "Active",
            is_super_admin: Boolean(input.isSuperAdmin),
            employee_id: input.employeeId ?? null,
        })
            .select()
            .single();
        if (error)
            throw new AppError(error.message, 500);
        await UserAdminService.setUserAccess(id, {
            propertyIds,
            permissions: input.permissions ?? [],
        });
        const listed = await UserAdminService.listUsers();
        const created = listed.find((u) => u.id === id);
        if (!created)
            throw new AppError("Failed to load created user", 500);
        return created;
    },
    async setUserAccess(userId, input) {
        await supabase.from(ACCESS).delete().eq("user_id", userId);
        await supabase.from(PERMS).delete().eq("user_id", userId);
        const propertyIds = [...new Set(input.propertyIds.filter(Boolean))];
        if (propertyIds.length) {
            const accessRows = propertyIds.map((propertyId, idx) => ({
                user_id: userId,
                property_id: propertyId,
                is_default: idx === 0,
            }));
            const { error } = await supabase.from(ACCESS).insert(accessRows);
            if (error)
                throw new AppError(error.message, 500);
        }
        const validModules = new Set(PLATFORM_MODULES.map((m) => m.key));
        const permRows = input.permissions
            .filter((p) => validModules.has(p.moduleKey))
            .map((p) => ({
            id: crypto.randomUUID(),
            user_id: userId,
            property_id: p.propertyId,
            module_key: p.moduleKey,
            permission: p.permission,
        }));
        if (permRows.length) {
            const { error } = await supabase.from(PERMS).insert(permRows);
            if (error)
                throw new AppError(error.message, 500);
        }
    },
    async updateUser(userId, patch) {
        const existing = (await UserAdminService.listUsers()).find((u) => u.id === userId);
        if (!existing)
            throw new NotFoundError("User not found");
        const nextPropertyIds = patch.propertyIds ?? existing.propertyIds;
        if (patch.employeeId !== undefined) {
            await assertEmployeeLink({
                employeeId: patch.employeeId,
                propertyIds: nextPropertyIds,
            });
        }
        const body = {};
        if (patch.name != null)
            body.name = patch.name.trim();
        if (patch.role != null)
            body.role = patch.role.trim();
        if (patch.status != null)
            body.status = patch.status;
        if (patch.isSuperAdmin != null)
            body.is_super_admin = patch.isSuperAdmin;
        if (patch.employeeId !== undefined)
            body.employee_id = patch.employeeId;
        if (Object.keys(body).length) {
            const { error } = await supabase.from(USERS).update(body).eq("id", userId);
            if (error)
                throw new AppError(error.message, 500);
        }
        if (patch.propertyIds || patch.permissions) {
            await UserAdminService.setUserAccess(userId, {
                propertyIds: nextPropertyIds,
                permissions: patch.permissions ?? existing.permissions,
            });
        }
        const listed = await UserAdminService.listUsers();
        const updated = listed.find((u) => u.id === userId);
        if (!updated)
            throw new NotFoundError("User not found");
        return updated;
    },
    async getMyPermissions(userId, propertyId, isSuperAdmin) {
        if (isSuperAdmin) {
            return Object.fromEntries(PLATFORM_MODULES.map((m) => [m.key, "admin"]));
        }
        const { data, error } = await supabase
            .from(PERMS)
            .select("*")
            .eq("user_id", userId)
            .eq("property_id", propertyId);
        if (error)
            throw new AppError(error.message, 500);
        const map = {};
        for (const row of data ?? []) {
            map[String(row.module_key)] = row.permission;
        }
        return map;
    },
};
//# sourceMappingURL=user-admin.service.js.map
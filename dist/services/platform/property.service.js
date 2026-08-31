import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError } from "../../errors/index.js";
import { isPlatformAdmin } from "../../utils/platform-admin.js";
const PROPERTIES = "properties";
const ACCESS = "user_property_access";
const PERMS = "user_permissions";
function initialsFromName(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2)
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
}
export const PropertyService = {
    async userCanAccessProperty(userId, propertyId, isSuperAdmin, role) {
        if (isPlatformAdmin({ isSuperAdmin, role }))
            return true;
        const { data, error } = await supabase
            .from(ACCESS)
            .select("property_id")
            .eq("user_id", userId)
            .eq("property_id", propertyId)
            .maybeSingle();
        if (error)
            throw new AppError(error.message, 500);
        return Boolean(data);
    },
    async listForUser(userId, isSuperAdmin, role) {
        if (isPlatformAdmin({ isSuperAdmin, role })) {
            const { data, error } = await supabase
                .from(PROPERTIES)
                .select("*")
                .eq("status", "Active")
                .order("name");
            if (error)
                throw new AppError(error.message, 500);
            return toCamel(data ?? []);
        }
        const { data: links, error: linkErr } = await supabase
            .from(ACCESS)
            .select("property_id, is_default")
            .eq("user_id", userId);
        if (linkErr)
            throw new AppError(linkErr.message, 500);
        if (!links?.length)
            return [];
        const ids = links.map((l) => String(l.property_id));
        const { data, error } = await supabase
            .from(PROPERTIES)
            .select("*")
            .in("id", ids)
            .eq("status", "Active")
            .order("name");
        if (error)
            throw new AppError(error.message, 500);
        const defaultId = links.find((l) => l.is_default)?.property_id ?? links[0]?.property_id;
        return toCamel(data ?? []).map((p) => ({
            ...p,
            isDefault: String(p.id) === String(defaultId),
        }));
    },
    async create(input) {
        const name = input.name.trim();
        const code = input.code.trim().toLowerCase();
        if (!name || !code)
            throw new AppError("Name and code are required", 400);
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
        if (error)
            throw new AppError(error.message, 500);
        return toCamel(data);
    },
    async update(id, patch) {
        const body = {};
        if (patch.name != null)
            body.name = patch.name.trim();
        if (patch.code != null)
            body.code = patch.code.trim().toLowerCase();
        if (patch.city != null)
            body.city = patch.city.trim();
        if (patch.timezone != null)
            body.timezone = patch.timezone;
        if (patch.status != null)
            body.status = patch.status;
        body.updated_at = new Date().toISOString();
        const { data, error } = await supabase
            .from(PROPERTIES)
            .update(body)
            .eq("id", id)
            .select()
            .single();
        if (error)
            throw new AppError(error.message, 500);
        if (!data)
            throw new NotFoundError("Property not found");
        return toCamel(data);
    },
    async getUserPermissions(userId, propertyId) {
        const { data, error } = await supabase
            .from(PERMS)
            .select("*")
            .eq("user_id", userId)
            .eq("property_id", propertyId);
        if (error)
            throw new AppError(error.message, 500);
        return toCamel(data ?? []);
    },
    async userHasModulePermission(userId, propertyId, moduleKey, level, isSuperAdmin) {
        if (isSuperAdmin)
            return true;
        const perms = await this.getUserPermissions(userId, propertyId);
        const row = perms.find((p) => p.moduleKey === moduleKey);
        if (!row)
            return false;
        if (level === "read")
            return ["read", "write", "admin"].includes(row.permission);
        return ["write", "admin"].includes(row.permission);
    },
    assertModulePermission(userId, propertyId, moduleKey, level, isSuperAdmin) {
        void userId;
        void propertyId;
        void moduleKey;
        void level;
        void isSuperAdmin;
        // Enforced on frontend for now; hook for future route-level RBAC.
    },
    initialsFromPropertyName: initialsFromName,
};
//# sourceMappingURL=property.service.js.map
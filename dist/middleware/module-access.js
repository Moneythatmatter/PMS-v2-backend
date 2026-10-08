import { PermissionError, UnauthorizedError, AppError } from "../errors/index.js";
import { UserAdminService } from "../services/platform/user-admin.service.js";
import { isPlatformAdmin } from "../utils/platform-admin.js";
const CACHE_TTL_MS = 30_000;
const permissionCache = new Map();
export function invalidateModuleAccessCache(userId) {
    if (!userId) {
        permissionCache.clear();
        return;
    }
    for (const key of permissionCache.keys()) {
        if (key.startsWith(`${userId}:`))
            permissionCache.delete(key);
    }
}
async function loadPermissions(userId, propertyId) {
    const key = `${userId}:${propertyId}`;
    const cached = permissionCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS)
        return cached.perms;
    const perms = (await UserAdminService.getMyPermissions(userId, propertyId));
    permissionCache.set(key, { at: Date.now(), perms });
    return perms;
}
function matchesRule(rule, method, path) {
    const methodOk = rule.methods === "*" || rule.methods.includes(method);
    return methodOk && rule.path.test(path);
}
/**
 * Blocks the request unless the user has any permission on one of `modules`
 * for the active property. Must run after `requireAuth` and `requireProperty`.
 */
export function requireModule(modules, shared = []) {
    const owners = Array.isArray(modules) ? modules : [modules];
    return (req, _res, next) => {
        void (async () => {
            try {
                if (!req.auth?.userId)
                    throw new UnauthorizedError("Authentication required");
                if (isPlatformAdmin(req.auth))
                    return next();
                if (!req.propertyId) {
                    throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
                }
                const perms = await loadPermissions(req.auth.userId, req.propertyId);
                const has = (key) => Boolean(perms[key]);
                if (owners.some(has))
                    return next();
                const sharedRule = shared.find((r) => matchesRule(r, req.method, req.path));
                if (sharedRule) {
                    const allowed = sharedRule.modules === "any"
                        ? Object.keys(perms).length > 0
                        : sharedRule.modules.some(has);
                    if (allowed)
                        return next();
                }
                throw new PermissionError("You do not have access to this module");
            }
            catch (e) {
                next(e);
            }
        })();
    };
}
//# sourceMappingURL=module-access.js.map
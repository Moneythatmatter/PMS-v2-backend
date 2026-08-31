import { runWithRequestStore } from "../utils/request-context.js";
export function attachRequestContext(req, _res, next) {
    const store = {
        userId: req.auth?.userId,
        userRole: req.auth?.role,
        isSuperAdmin: req.auth?.isSuperAdmin,
        propertyId: req.propertyId,
    };
    runWithRequestStore(store, () => next());
}
//# sourceMappingURL=request-context.js.map
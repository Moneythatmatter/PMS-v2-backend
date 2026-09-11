import { fromError } from "../utils/response.js";
import { UnauthorizedError } from "../errors/index.js";
import { attachRequestContext } from "./request-context.js";
import { resolveEmployeeContextForUser } from "../services/employee-portal/employee-context.service.js";
function asEmployeeRequest(req) {
    return req;
}
export function requireEmployeePortal(req, res, next) {
    void (async () => {
        try {
            if (!req.auth?.userId) {
                throw new UnauthorizedError("Authentication required");
            }
            const resolved = await resolveEmployeeContextForUser(req.auth.userId, {
                isSuperAdmin: req.auth.isSuperAdmin,
                role: req.auth.role,
            });
            const er = asEmployeeRequest(req);
            er.employeeId = resolved.employeeId;
            er.propertyId = resolved.propertyId;
            er.employeeContext = resolved.employee;
            attachRequestContext(er, res, next);
        }
        catch (e) {
            return fromError(res, e);
        }
    })();
}
//# sourceMappingURL=employee-portal.js.map
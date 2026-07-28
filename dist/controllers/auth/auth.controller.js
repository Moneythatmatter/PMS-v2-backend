import { AuthService } from "../../services/auth/auth.service.js";
import { fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
import { loginSchema } from "../../validators/auth.js";
import { UnauthorizedError } from "../../errors/index.js";
function bearerToken(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return null;
    return header.slice(7).trim() || null;
}
export async function login(req, res) {
    try {
        const body = parseBody(loginSchema, req.body);
        const result = await AuthService.login(body.email, body.password);
        return ok(res, result);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function me(req, res) {
    try {
        const token = bearerToken(req);
        if (!token)
            throw new UnauthorizedError("Missing authorization token");
        const user = await AuthService.me(token);
        return ok(res, user);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=auth.controller.js.map
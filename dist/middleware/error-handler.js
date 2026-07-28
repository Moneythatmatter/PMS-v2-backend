import { fromError } from "../utils/response.js";
/** Express error middleware — maps AppError / ValidationError to HTTP. */
export function errorHandler(err, _req, res, _next) {
    return fromError(res, err);
}
//# sourceMappingURL=error-handler.js.map
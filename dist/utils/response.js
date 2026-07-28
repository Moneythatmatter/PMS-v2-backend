import { AppError, ValidationError } from "../errors/index.js";
export function ok(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
export function fail(res, error, status = 400) {
    return res.status(status).json({ success: false, error });
}
export function fromError(res, error, status = 500) {
    if (error instanceof ValidationError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
        });
    }
    if (error instanceof AppError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return fail(res, message, status);
}
//# sourceMappingURL=response.js.map
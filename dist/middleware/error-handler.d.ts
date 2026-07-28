import type { NextFunction, Request, Response } from "express";
/** Express error middleware — maps AppError / ValidationError to HTTP. */
export declare function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): Response<any, Record<string, any>>;

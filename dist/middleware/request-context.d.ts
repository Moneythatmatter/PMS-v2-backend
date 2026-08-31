import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
export type ContextRequest = AuthedRequest & {
    propertyId?: string;
};
export declare function attachRequestContext(req: ContextRequest, _res: Response, next: NextFunction): void;

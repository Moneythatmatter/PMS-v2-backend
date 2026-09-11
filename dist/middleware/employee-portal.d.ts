import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
import { type ContextRequest } from "./request-context.js";
import type { EmployeePortalContext } from "../types/auth.js";
export type EmployeePortalRequest = ContextRequest & {
    employeeId: string;
    employeeContext: EmployeePortalContext;
};
export declare function requireEmployeePortal(req: AuthedRequest, res: Response, next: NextFunction): void;

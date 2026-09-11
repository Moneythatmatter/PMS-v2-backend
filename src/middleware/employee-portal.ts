import type { NextFunction, Response } from "express";
import { fromError } from "../utils/response.js";
import { UnauthorizedError } from "../errors/index.js";
import type { AuthedRequest } from "./auth.js";
import { attachRequestContext, type ContextRequest } from "./request-context.js";
import { resolveEmployeeContextForUser } from "../services/employee-portal/employee-context.service.js";
import type { EmployeePortalContext } from "../types/auth.js";

export type EmployeePortalRequest = ContextRequest & {
  employeeId: string;
  employeeContext: EmployeePortalContext;
};

function asEmployeeRequest(req: AuthedRequest): EmployeePortalRequest {
  return req as EmployeePortalRequest;
}

export function requireEmployeePortal(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
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
    } catch (e) {
      return fromError(res, e);
    }
  })();
}

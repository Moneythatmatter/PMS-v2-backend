import type { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/auth/auth.service.js";
import { TenantService } from "../services/saas/tenant.service.js";
import { fromError } from "../utils/response.js";
import { UnauthorizedError } from "../errors/index.js";

export type AuthedRequest = Request & {
  auth?: {
    userId: string;
    email: string;
    role: string;
    isSuperAdmin?: boolean;
  };
};

/** Protect routes: valid JWT + active tenant membership (unless platform super-admin). */
export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  void (async () => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw new UnauthorizedError("Missing authorization token");
      }
      const token = header.slice(7).trim();
      const payload = AuthService.verifyToken(token);
      req.auth = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        isSuperAdmin: payload.isSuperAdmin,
      };
      await TenantService.assertUserCanUsePms(
        payload.sub,
        Boolean(payload.isSuperAdmin),
      );
      next();
    } catch (e) {
      return fromError(res, e);
    }
  })();
}

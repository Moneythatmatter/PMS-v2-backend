import type { NextFunction, Response } from "express";
import { AppError, PermissionError, UnauthorizedError } from "../errors/index.js";
import { PropertyService } from "../services/platform/property.service.js";
import type { ContextRequest } from "./request-context.js";

export function requireProperty(
  req: ContextRequest,
  res: Response,
  next: NextFunction,
) {
  void (async () => {
    try {
      if (!req.auth?.userId) {
        throw new UnauthorizedError("Authentication required");
      }

      const raw = String(
        req.headers["x-property-id"] ?? req.query.propertyId ?? "",
      ).trim();
      if (!raw) {
        throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
      }

      const allowed = await PropertyService.userCanAccessProperty(
        req.auth.userId,
        raw,
        req.auth.isSuperAdmin,
        req.auth.role,
      );
      if (!allowed) {
        throw new PermissionError("You do not have access to this property");
      }

      req.propertyId = raw;
      next();
    } catch (e) {
      next(e);
    }
  })();
}

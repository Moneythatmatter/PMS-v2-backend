import type { NextFunction, Response } from "express";
import type { ModuleKey } from "../types/platform.js";
import type { ContextRequest } from "./request-context.js";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Lets users of other modules reach specific endpoints (e.g. room lookups from housekeeping). */
export type SharedAccessRule = {
    methods: Method[] | "*";
    path: RegExp;
    modules: ModuleKey[] | "any";
};
export declare function invalidateModuleAccessCache(userId?: string): void;
/**
 * Blocks the request unless the user has any permission on one of `modules`
 * for the active property. Must run after `requireAuth` and `requireProperty`.
 */
export declare function requireModule(modules: ModuleKey | ModuleKey[], shared?: SharedAccessRule[]): (req: ContextRequest, _res: Response, next: NextFunction) => void;
export {};

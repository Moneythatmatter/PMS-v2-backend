import type { NextFunction, Request, Response } from "express";
export type AuthedRequest = Request & {
    auth?: {
        userId: string;
        email: string;
        role: string;
        isSuperAdmin?: boolean;
    };
};
/** Optional auth middleware for protecting routes later. */
export declare function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;

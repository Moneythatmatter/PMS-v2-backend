import type { NextFunction, Request, Response } from "express";
export type AuthedRequest = Request & {
    auth?: {
        userId: string;
        email: string;
        role: string;
    };
};
/** Optional auth middleware for protecting routes later. */
export declare function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;

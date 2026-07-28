import type { Response } from "express";
export declare function ok<T>(res: Response, data: T, status?: number): Response<any, Record<string, any>>;
export declare function fail(res: Response, error: string, status?: number): Response<any, Record<string, any>>;
export declare function fromError(res: Response, error: unknown, status?: number): Response<any, Record<string, any>>;

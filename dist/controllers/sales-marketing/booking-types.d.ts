import type { Request, Response } from "express";
export declare function ensureSystemBookingTypes(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listBookingTypes(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

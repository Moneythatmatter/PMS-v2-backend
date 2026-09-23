import type { Request, Response } from "express";
export declare function getDashboard(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Aggregate reports from live work orders / PM schedules. */
export declare function getReports(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

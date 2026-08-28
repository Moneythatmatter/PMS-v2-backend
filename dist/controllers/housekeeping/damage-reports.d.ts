import type { Request, Response } from "express";
export declare function listDamageReports(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getDamageReport(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createDamageReport(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateDamageReport(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function resolveDamageReport(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

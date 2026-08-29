import type { Request, Response } from "express";
export declare function getDashboard(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listStockLedger(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listGrnsByPo(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

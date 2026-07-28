import type { Request, Response } from "express";
export declare function listLiveTables(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateLiveTable(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function seatTable(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function settleTable(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function cleanTable(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

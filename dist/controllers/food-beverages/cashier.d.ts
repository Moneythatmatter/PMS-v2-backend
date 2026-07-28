import type { Request, Response } from "express";
export declare function listShifts(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function openShift(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function closeShift(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateShift(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

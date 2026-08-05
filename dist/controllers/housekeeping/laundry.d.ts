import type { Request, Response } from "express";
export declare function listLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function advanceLaundry(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

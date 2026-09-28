import type { Request, Response } from "express";
export declare function listLaundryItems(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getLaundryItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createLaundryItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateLaundryItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteLaundryItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

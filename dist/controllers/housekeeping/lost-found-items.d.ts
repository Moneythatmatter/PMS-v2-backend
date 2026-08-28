import type { Request, Response } from "express";
export declare function listLostFoundItems(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function returnLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function claimLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function disposeLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function courierLostFoundItem(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

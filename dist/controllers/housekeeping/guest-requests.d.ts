import type { Request, Response } from "express";
export declare function listGuestRequests(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function assignGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function startGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function completeGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function cancelGuestRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

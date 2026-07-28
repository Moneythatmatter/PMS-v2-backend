import type { Request, Response } from "express";
export declare function listKds(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createKds(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateKds(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function advanceKds(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

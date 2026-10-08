import type { Request, Response } from "express";
export declare function listGroups(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

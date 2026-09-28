import type { Request, Response } from "express";
export declare function listGroups(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateGroup(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listGroupReservations(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getGroupFolio(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listGroupBillingRules(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateGroupBillingRules(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

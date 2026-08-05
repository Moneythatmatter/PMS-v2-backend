import type { Request, Response } from "express";
export declare function listRequisitions(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function approveRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function issueRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function rejectRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

import type { Request, Response } from "express";
export declare function listOrders(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function advanceOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

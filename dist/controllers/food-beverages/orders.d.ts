import type { Request, Response } from "express";
export declare function listOrders(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function advanceOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Kitchen accepts a pending order → Preparing (+ optional prep ETA minutes). */
export declare function acceptOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Kitchen rejects a pending order with a reason. */
export declare function rejectOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** POS collects payment — routes through fb_bills + transactions when available. */
export declare function payOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

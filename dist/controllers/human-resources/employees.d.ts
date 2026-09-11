import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
export declare function listEmployees(_req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getEmployee(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createEmployee(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateEmployee(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteEmployee(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;

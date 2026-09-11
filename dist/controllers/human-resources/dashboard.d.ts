import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
export declare function getDashboard(_req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;

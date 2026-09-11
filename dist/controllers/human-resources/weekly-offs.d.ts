import type { Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
export declare function listWeeklyOffs(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getWeeklyOff(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getStaffingPreview(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createWeeklyOff(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateWeeklyOff(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteWeeklyOff(req: ContextRequest, res: Response): Promise<Response<any, Record<string, any>>>;

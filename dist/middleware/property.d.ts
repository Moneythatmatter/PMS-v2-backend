import type { NextFunction, Response } from "express";
import type { ContextRequest } from "./request-context.js";
export declare function requireProperty(req: ContextRequest, res: Response, next: NextFunction): void;

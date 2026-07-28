import type { NextFunction, Request, Response } from "express";
/** Dev request logger — prints each API hit to the terminal. */
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;

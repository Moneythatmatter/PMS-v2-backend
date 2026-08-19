import type { Request, Response } from "express";
export declare function listRooms(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Assign cleaner — status → INSPECTING. */
export declare function startClean(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Pause/resume — notes only (no timer column in slim schema). */
export declare function pauseClean(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Cleaning finished — awaiting inspection. */
export declare function completeClean(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Supervisor pass / fail inspection. */
export declare function inspectRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Mark room dirty (checkout / stay-over). */
export declare function markDirty(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

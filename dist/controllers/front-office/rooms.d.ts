import type { Request, Response } from "express";
export declare function listRooms(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listRoomBlocks(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function roomAvailability(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function roomStatusCards(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

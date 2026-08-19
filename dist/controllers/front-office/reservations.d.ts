import type { Request, Response } from "express";
/**
 * Thin HTTP adapter — no business rules here.
 * All workflows live in ReservationService.
 */
export declare function listReservations(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getReservation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getCurrentForRoom(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createReservation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateReservation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteReservation(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function checkIn(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function checkOut(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function extendStay(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getSummary(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listInHouse(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

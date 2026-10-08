import type { Request, Response } from "express";
/**
 * POST /stock-balances/opening — put stock that already exists on the books, with its rate.
 * Adds to the store balance (weighted-average cost) and writes an "Opening Stock" ledger line per material.
 */
export declare function postOpeningStock(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

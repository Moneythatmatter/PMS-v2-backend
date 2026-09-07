import type { Request, Response } from "express";
export declare function listPayrollRecords(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updatePayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function approvePayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function recordSalaryPayment(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listAuditLogs(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

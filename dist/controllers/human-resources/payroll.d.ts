import type { Request, Response } from "express";
export declare function listPayrollRecords(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Edit earnings / deductions. Blocked once approved (locked). Status changes go through the workflow endpoints. */
export declare function updatePayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function calculatePayrollRecords(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function verifyPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function verifyPayrollBatch(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function approvePayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function approvePayrollBatch(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function unlockPayrollRecord(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function recordSalaryPayment(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listSalaryPayments(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function sendPayslipById(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function sendPayslipBatch(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listAuditLogs(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

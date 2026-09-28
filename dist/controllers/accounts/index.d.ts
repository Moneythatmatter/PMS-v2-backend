import type { Request, Response } from "express";
import { masters } from "../../services/accounts/masters.service.js";
type Handler = (req: Request) => Promise<unknown>;
/** Wrap a service call: 200 with data, or mapped error response. */
export declare function handle(fn: Handler, status?: number): (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare function masterHandlers(key: keyof typeof masters): {
    list: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    get: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    create: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    update: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    remove: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const getCompanySettings: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const updateCompanySettings: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const lookups: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const accountTree: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const fiscalYearActions: {
    open: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    setCurrent: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    close: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reopen: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const periods: {
    list: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    close: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reopen: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const auditLogs: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const voucherHandlers: {
    list: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    get: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    nextNumber: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    create: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    update: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    remove: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    post: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reverse: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    convert: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    print: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    receiptPayment: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const bankRecon: {
    get: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reconcile: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    unreconcile: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const closingStockPost: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const billHandlers: {
    list: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    get: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    create: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    update: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    cancel: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    settle: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    removeSettlement: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const coveringLetterHandlers: {
    list: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    candidates: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    create: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reverse: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export declare const reportHandlers: {
    trialBalance: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    profitLoss: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    balanceSheet: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    generalLedger: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    dayBook: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    outstandingBills: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    agingSummary: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    partySettlement: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    reminderLetters: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    balanceConfirmation: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    paymentAdvice: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    analysis: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
    dashboard: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
};
export {};

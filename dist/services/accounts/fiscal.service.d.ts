import { type Row } from "../../models/accounts/repo.js";
export declare function generatePeriodsForYear(fy: {
    id: string;
    startDate: string;
    endDate: string;
}): Promise<void>;
export declare function getSettings(): Promise<Row | null>;
export declare function findFiscalYear(date: string): Promise<Row | null>;
export declare function findPeriod(fiscalYearId: string, date: string): Promise<Row | null>;
export declare function currentFiscalYear(): Promise<Row | null>;
/** Resolve fiscal year + period for a voucher date and make sure posting is allowed. */
export declare function resolvePostingWindow(date: string, opts?: {
    enforceSettings?: boolean;
}): Promise<{
    fiscalYear: Row;
    period: Row | null;
}>;
export declare function openFiscalYear(id: string): Promise<Row>;
export declare function setCurrentFiscalYear(id: string): Promise<Row>;
export declare function closeFiscalYear(id: string): Promise<Row>;
export declare function reopenFiscalYear(id: string, reason: string): Promise<Row>;
export type PeriodChecks = {
    unpostedVouchers: number;
    trialBalanceDifference: number;
    trialBalanced: boolean;
    unreconciledBankLines: number;
    pendingClosingStock: number;
    postedVouchers: number;
    totalDebit: number;
    totalCredit: number;
};
export declare function listPeriods(fiscalYearId?: string): Promise<{
    fiscalYearName: any;
    fiscalYearStatus: any;
    checks: PeriodChecks | undefined;
}[]>;
export declare function closePeriod(id: string, opts?: {
    force?: boolean;
}): Promise<{
    checks: PeriodChecks;
}>;
export declare function reopenPeriod(id: string, reason: string): Promise<Row>;
export declare function listAuditLogs(query: {
    entityType?: string;
    entityId?: string;
    limit?: number;
}): Promise<Row[]>;

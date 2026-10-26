export declare const PAYROLL_STATUS: {
    readonly draft: "Draft";
    readonly calculated: "Calculated";
    readonly verified: "Verified";
    readonly approved: "Approved";
    readonly partiallyPaid: "Partially Paid";
    readonly paid: "Paid";
};
export type PayrollRecordRow = {
    id: string;
    propertyId?: string;
    employeeId: string;
    payrollMonth: number;
    payrollYear: number;
    payrollBatchId?: string;
    grossSalary: number;
    earningsTotal: number;
    deductionsTotal: number;
    netSalary: number;
    status: string;
    isLocked?: boolean;
    calculatedAt?: string | null;
    verifiedAt?: string | null;
    approvedAt?: string | null;
    earningsBreakdown?: Record<string, number>;
    deductionsBreakdown?: Record<string, number>;
    validationFlags?: Record<string, boolean>;
    payslipGenerated?: boolean;
    createdAt: string;
    updatedAt: string;
};
export declare function writePayrollAudit(entry: {
    action: string;
    entityType: string;
    entityId?: string;
    changedBy: string;
    notes?: string;
    overrideReason?: string;
}): Promise<void>;
export declare function totalsFromBreakdown(earnings: Record<string, number>, deductions: Record<string, number>): {
    grossSalary: number;
    earningsTotal: number;
    deductionsTotal: number;
    netSalary: number;
};
export declare function calculatePayroll(input: {
    month: number;
    year: number;
    employeeIds?: string[];
    actor: string;
}): Promise<{
    total: number;
    calculated: number;
    draft: number;
    skipped: {
        employeeId: string;
        reason: string;
    }[];
    batchId: string;
}>;
export declare function getRecordOrThrow(id: string): Promise<PayrollRecordRow>;
export declare function assertEditable(row: PayrollRecordRow): void;
export declare function updatePayrollAmounts(id: string, input: {
    earnings: Record<string, number>;
    deductions: Record<string, number>;
    reason?: string;
}, actor: string): Promise<PayrollRecordRow>;
export declare function verifyRecord(id: string, actor: string): Promise<PayrollRecordRow>;
export declare function approveRecord(id: string, actor: string): Promise<PayrollRecordRow>;
export declare function verifyBatch(input: {
    ids?: string[];
    month?: number;
    year?: number;
}, actor: string): Promise<{
    updated: number;
    skipped: {
        id: string;
        reason: string;
    }[];
}>;
export declare function approveBatch(input: {
    ids?: string[];
    month?: number;
    year?: number;
}, actor: string): Promise<{
    updated: number;
    skipped: {
        id: string;
        reason: string;
    }[];
}>;
export declare function unlockRecord(id: string, reason: string, actor: string): Promise<PayrollRecordRow>;
export declare function generatePayslipForPayroll(payrollId: string): Promise<unknown>;
export declare function sendPayslip(id: string, actor: string): Promise<unknown>;
export declare function sendPayslipsBatch(input: {
    ids?: string[];
    payrollIds?: string[];
    month?: number;
    year?: number;
}, actor: string): Promise<{
    sent: number;
    skipped: {
        id: string;
        reason: string;
    }[];
}>;
export declare function paidAmountFor(payrollIds: string[]): Promise<Map<string, number>>;
export declare function syncPayrollPaymentStatus(payrollId: string): Promise<PayrollRecordRow>;
export declare function recordPayment(payrollId: string, body: Record<string, unknown>, actor: string): Promise<{
    payment: {
        id: string;
    };
    payrollStatus: string;
}>;
export declare function listPayments(payrollId: string): Promise<Record<string, unknown>[]>;
/** Payslip + payment summary per payroll record, for list screens. */
export declare function payrollExtras(payrollIds: string[]): Promise<Map<string, {
    payslipId?: string;
    payslipNo?: string;
    payslipStatus?: string;
    paidAmount: number;
}>>;

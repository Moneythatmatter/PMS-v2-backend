import { type Row } from "../../models/accounts/repo.js";
export type VoucherLineInput = {
    accountId: string;
    partyId?: string | null;
    divisionId?: string | null;
    debit?: number | string;
    credit?: number | string;
    narration?: string;
    chequeNo?: string;
    chequeDate?: string | null;
    gstRate?: number | string | null;
};
export type BillAllocationInput = {
    billId: string;
    amount: number | string;
    deductions?: number | string;
};
export type NewBillInput = {
    moduleType: "AR" | "AP";
    refType?: string;
    billNo: string;
    billDate?: string;
    dueDate?: string;
    amount?: number | string;
    details?: string;
    partyId?: string;
    divisionId?: string | null;
};
export type VoucherInput = {
    voucherTypeId?: string;
    voucherTypeCode?: string;
    voucherNo?: string;
    voucherDate: string;
    referenceNo?: string;
    narration?: string;
    status?: "Draft" | "Posted" | "Provisional";
    partyId?: string | null;
    divisionId?: string | null;
    bankCashAccountId?: string | null;
    paymentMethodId?: string | null;
    instrumentNo?: string;
    instrumentDate?: string | null;
    provisionalCategory?: string | null;
    provisionalType?: string | null;
    expiryDate?: string | null;
    sourceModule?: string;
    lines: VoucherLineInput[];
    billAllocations?: BillAllocationInput[];
    newBill?: NewBillInput | null;
};
export declare function nextVoucherNo(voucherType: Row, date: string, fiscalYear: Row): Promise<string>;
export declare function previewNextNumber(voucherTypeId: string, date?: string): Promise<{
    voucherNo: string;
    fiscalYearId: any;
    fiscalYearName: any;
}>;
export declare function createVoucher(input: VoucherInput, opts?: {
    enforceSettings?: boolean;
}): Promise<Row>;
export declare function updateVoucher(id: string, input: VoucherInput): Promise<Row>;
export declare function deleteVoucher(id: string): Promise<{
    id: string;
}>;
export declare function postVoucher(id: string, body?: {
    billAllocations?: BillAllocationInput[];
    newBill?: NewBillInput;
}): Promise<Row>;
export declare function reverseVoucher(id: string, reason: string): Promise<Row>;
export declare function convertProvisional(id: string, body: {
    voucherDate?: string;
    voucherTypeId?: string;
    narration?: string;
}): Promise<{
    provisional: Row;
    voucher: Row;
}>;
export declare function markPrinted(id: string): Promise<Row>;
export declare function listVouchers(query: Record<string, unknown>): Promise<Row[]>;
export declare function getVoucher(id: string): Promise<Row>;
export type ReceiptPaymentInput = {
    type: "Receipt" | "Payment";
    voucherTypeId?: string;
    voucherDate: string;
    bankCashAccountId: string;
    paymentMethodId?: string | null;
    instrumentNo?: string;
    instrumentDate?: string | null;
    referenceNo?: string;
    narration?: string;
    partyId?: string | null;
    status?: "Draft" | "Posted";
    lines: {
        accountId: string;
        partyId?: string | null;
        divisionId?: string | null;
        amount: number | string;
        narration?: string;
        billId?: string | null;
    }[];
};
export declare function createReceiptPayment(input: ReceiptPaymentInput): Promise<Row>;
export declare function bankReconciliation(query: Record<string, unknown>): Promise<{
    bankAccounts: never[];
    account: null;
    entries: never[];
    summary: null;
    asOn?: undefined;
} | {
    bankAccounts: {
        id: any;
        code: any;
        name: any;
        bankAccountNo: any;
        bankIfsc: any;
    }[];
    account: {
        id: any;
        code: any;
        name: any;
        bankAccountNo: any;
        bankIfsc: any;
    };
    asOn: string;
    entries: Row[];
    summary: {
        bookBalance: number;
        balanceAsPerBank: number;
        unreconciledDebit: number;
        unreconciledCredit: number;
        unreconciledCount: number;
        difference: number;
    };
}>;
export declare function reconcileLines(items: {
    lineId: string;
    reconDate: string;
}[]): Promise<{
    reconciled: number;
}>;
export declare function unreconcileLines(lineIds: string[], reason: string): Promise<{
    unreconciled: number;
}>;
export declare function postClosingStock(body: {
    itemIds?: string[];
    valuationDate?: string;
    postingDate?: string;
}): Promise<{
    posted: number;
    voucher: Row | null;
}>;

import { type Row } from "../../models/accounts/repo.js";
export type BillView = Row & {
    amount: number;
    settledAmount: number;
    balance: number;
    overdueDays: number;
    billAgeDays: number;
    partyName: string | null;
    partyCode: string | null;
    partyGroup: string | null;
    settlementStatus: "Unpaid" | "Partial" | "Settled";
};
/** Bills with settlement totals as on a date (defaults to today). */
export declare function loadBills(query?: {
    moduleType?: string;
    partyId?: string;
    partyIds?: string[];
    partyGroup?: string;
    status?: string;
    asOnDate?: string;
    pendingOnly?: boolean;
    billFrom?: string;
    billTo?: string;
}): Promise<BillView[]>;
export declare function listBills(query: Record<string, unknown>): Promise<{
    coveringLetterNo: string | null;
    amount: number;
    settledAmount: number;
    balance: number;
    overdueDays: number;
    billAgeDays: number;
    partyName: string | null;
    partyCode: string | null;
    partyGroup: string | null;
    settlementStatus: "Unpaid" | "Partial" | "Settled";
}[]>;
export declare function getBill(id: string): Promise<BillView>;
export declare function createBill(body: Row): Promise<BillView>;
export declare function updateBill(id: string, body: Row): Promise<BillView>;
export declare function cancelBill(id: string, reason: string): Promise<BillView>;
export declare function settleBill(billId: string, body: {
    amount: number | string;
    settlementDate?: string;
    voucherId?: string;
    deductions?: number | string;
    referenceNo?: string;
    trnType?: string;
    remarks?: string;
}): Promise<BillView>;
export declare function deleteSettlement(id: string): Promise<{
    id: string;
}>;
export declare function applyAllocations(voucher: Row, allocations: {
    billId: string;
    amount: number | string;
    deductions?: number | string;
}[]): Promise<void>;
export declare function createBillForVoucher(voucher: Row, nb: {
    moduleType: "AR" | "AP";
    refType?: string;
    billNo: string;
    billDate?: string;
    dueDate?: string;
    amount?: number | string;
    details?: string;
    partyId?: string;
    divisionId?: string | null;
}, total: number): Promise<void>;
/** On voucher reversal: drop its settlements and cancel bills it raised (if unsettled elsewhere). */
export declare function releaseVoucherBills(voucher: Row): Promise<void>;
export declare function coveringLetterCandidates(query: Record<string, unknown>): Promise<BillView[]>;
export declare function listCoveringLetters(query: Record<string, unknown>): Promise<Row[]>;
export declare function createCoveringLetter(body: {
    letterDate?: string;
    billIds: string[];
    remarks?: string;
}): Promise<Row | undefined>;
export declare function reverseCoveringLetter(id: string, reason: string): Promise<Row | undefined>;

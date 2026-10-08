export declare const SOURCE_MODULES: readonly ["Front Office", "Housekeeping", "Food & Beverage", "Kitchen", "Maintenance", "Human Resources", "Accounts", "Sales & Marketing", "Security", "Purchase & Stores"];
/** Line item as exposed on `requestedItems` (shape the PR → RFQ → PO screens already use). */
export type RequisitionItem = {
    id: string;
    lineNo: number;
    materialId?: string;
    productCode?: string;
    item: string;
    category: string;
    quantity: number;
    unit: string;
    estimatedPrice: number;
    total: number;
    remarks?: string;
    approvedQty: number | null;
    orderedQty: number;
    receivedQty: number;
    stockOnHand: number | null;
    requiredDate?: string | null;
};
export type RequisitionHeader = {
    id: string;
    prNumber: string;
    sourceModule: string;
    status: string;
    currentApprover?: string;
    submittedAt?: string | null;
    approvedAt?: string | null;
    [key: string]: unknown;
};
export type Requisition = RequisitionHeader & {
    requestedItems: RequisitionItem[];
};
/** Attach child rows as `requestedItems`. Pass `all` when `headers` is the full table. */
export declare function attachItems<T extends {
    id: string;
}>(headers: T[], all?: boolean): Promise<(T & {
    requestedItems: RequisitionItem[];
})[]>;
export declare function listRequisitions(filters?: {
    status?: string;
    department?: string;
    sourceModules?: string[];
}): Promise<Requisition[]>;
export declare function getRequisition(id: string): Promise<Requisition | null>;
export declare function getRequisitionByNumber(prNumber: string): Promise<Requisition | null>;
export declare function createRequisition(body: Record<string, unknown>): Promise<Requisition>;
export declare function updateRequisition(id: string, body: Record<string, unknown>, prev: RequisitionHeader): Promise<Requisition>;
export declare function deleteRequisition(id: string): Promise<void>;
/** Persist sourcing / receiving progress computed from linked POs and GRNs. */
export declare function saveItemProgress(items: RequisitionItem[], next: {
    id: string;
    orderedQty?: number;
    receivedQty?: number;
}[]): Promise<void>;

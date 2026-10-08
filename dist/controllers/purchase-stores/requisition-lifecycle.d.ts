import type { Request, Response } from "express";
import * as requisitions from "../../models/purchase-stores/requisitions.js";
export declare const PR_STATUS: {
    readonly DRAFT: "Draft";
    readonly PENDING_APPROVAL: "Pending Approval";
    readonly APPROVED: "Approved";
    readonly IN_SOURCING: "In Sourcing";
    readonly PARTIALLY_ORDERED: "Partially Ordered";
    readonly CLOSED: "Closed";
    readonly REJECTED: "Rejected";
    readonly CANCELLED: "Cancelled";
};
export declare const PR_DOC: {
    numberField: string;
    prefix: string;
    dateDefaults: {
        requestDate: string;
        requiredDate: string;
    };
};
export declare const RFQ_DOC: {
    numberField: string;
    prefix: string;
    dateDefaults: {
        rfqDate: string;
        closingDate: string;
    };
};
export declare const PO_DOC: {
    numberField: string;
    prefix: string;
    dateDefaults: {
        orderDate: string;
    };
};
type PrRow = requisitions.Requisition;
type PoLine = {
    prItemId?: string;
    materialId?: string;
    productCode?: string;
    itemCode?: string;
    productName?: string;
    itemDescription?: string;
    quantity: number;
};
type PoRow = {
    id: string;
    poNumber: string;
    status: string;
    linkedPR?: string | null;
    linkedRFQ?: string | null;
    items: PoLine[];
};
export declare const RFQ_STATUS: {
    readonly VENDOR_SELECTED: "Vendor Selected";
    readonly CONVERTED_TO_PO: "Converted to PO";
    readonly CLOSED: "Closed";
};
export type PrItemFulfillment = {
    prItemId: string;
    item: string;
    unit: string;
    requested: number;
    ordered: number;
    remaining: number;
};
export declare function computeFulfillment(pr: PrRow, pos: PoRow[], excludePoId?: string): {
    items: PrItemFulfillment[];
    totalRequested: number;
    totalOrdered: number;
    totalRemaining: number;
};
export declare function derivePrStatus(currentStatus: string, fulfillment: ReturnType<typeof computeFulfillment>, hasOpenRfq: boolean): string;
/** Recompute and persist the PR status and per-item ordered / received qty from linked RFQs, POs and GRNs. */
export declare function syncPrStatus(prNumber: string | null | undefined): Promise<string | null>;
/** GRN stock posted for a PO — roll received qty up to the PR it came from. */
export declare function syncPrForPo(poNumber: string | null | undefined): Promise<void>;
/** GET /requisitions?sourceModule=Housekeeping,Kitchen&status=…&department=… */
export declare function listRequisitions(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listFulfillment(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getFulfillment(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** Bring stored PR statuses in line with their RFQs / POs (legacy data). */
export declare function reconcileStatuses(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteRequisition(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRfq(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRfq(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteRfq(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createPurchaseOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updatePurchaseOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deletePurchaseOrder(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export {};

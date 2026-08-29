import type { Request, Response } from "express";
type BatchAlloc = {
    batchNumber: string;
    expiryDate?: string;
    mfgDate?: string;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    storageWarehouse?: string;
    storageLocation?: string;
};
type GrnLine = {
    materialId?: string;
    productCode: string;
    productName: string;
    category: string;
    unit: string;
    orderedQty: number;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    unitRate: number;
    receivedValue: number;
    batchAllocations?: BatchAlloc[];
};
/** Post accepted GRN batches to stock ledger + batches after QC pass. */
export declare function postGrnStock(params: {
    grnNumber: string;
    poNumber: string;
    supplierName: string;
    warehouse: string;
    items: GrnLine[];
}): Promise<string[]>;
/** POST /grns — create GRN + pending QC task (no vendor invoice required). */
export declare function createGrn(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** PUT/PATCH quality inspection — post stock when completed with pass/partial. */
export declare function updateQualityInspection(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export {};

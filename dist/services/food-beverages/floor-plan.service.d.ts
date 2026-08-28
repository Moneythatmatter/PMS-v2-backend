type Row = Record<string, unknown>;
export type TableDisplayState = "BLANK" | "RUNNING" | "RUNNING_KOT" | "PRINTED" | "PAID";
/** Legacy UI status keys (ops.ts tableStatusStyles). */
export type LegacyTableStatus = "Available" | "Reserved" | "Occupied" | "Billing" | "Dirty";
declare function deriveDisplayState(input: {
    hasOpenSession: boolean;
    hasOpenOrder: boolean;
    hasActiveKot: boolean;
    billPrinted: boolean;
    paymentStatus: string;
    housekeeping: string;
}): TableDisplayState;
declare function loadContextForTable(table: Row): Promise<{
    displayState: TableDisplayState;
    status: LegacyTableStatus;
    session: Row;
    order: Row | null;
    bill: Row | null;
    kotCount: number;
    guest: {};
    server: {};
    covers: number;
    durationMin: number;
    checkAmount: number;
    openOrderId: string | null;
    openSessionId: string | null;
    openBillId: string | null;
}>;
export declare const FloorPlanService: {
    deriveDisplayState: typeof deriveDisplayState;
    DISPLAY_TO_LEGACY: Record<TableDisplayState, LegacyTableStatus>;
    listFloorPlan(outletId?: string): Promise<{
        displayState: TableDisplayState;
        status: string;
    }[]>;
    getTableFloorPlan(tableId: string): Promise<{
        displayState: TableDisplayState;
        status: LegacyTableStatus;
        session: Row;
        order: Row | null;
        bill: Row | null;
        kotCount: number;
        guest: {};
        server: {};
        covers: number;
        durationMin: number;
        checkAmount: number;
        openOrderId: string | null;
        openSessionId: string | null;
        openBillId: string | null;
    } | {
        displayState: TableDisplayState;
        status: string;
    } | null>;
};
export { loadContextForTable };

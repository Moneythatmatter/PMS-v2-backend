type Row = Record<string, unknown>;
export type PosLineInput = {
    menuItemId?: string;
    name: string;
    qty: number;
    unitPrice: number;
    note?: string;
};
export type SendKotInput = {
    outletId: string;
    type: string;
    ref?: string;
    liveTableId?: string;
    guest?: string;
    guestId?: string;
    guestNo?: string;
    reservationId?: string;
    pax?: number;
    server?: string;
    lines: PosLineInput[];
    print?: boolean;
    /** Reuse existing open order (add-on KOT) */
    orderId?: string;
};
declare function syncLegacyOrderLines(items: Row[]): {
    note?: string | undefined;
    name: string;
    qty: number;
}[];
declare function getOpenSessionForTable(liveTableId: string): Promise<Row>;
export declare const PosService: {
    sendKot(input: SendKotInput): Promise<{
        order: Row | null;
        session: Row | null;
        kot: Row;
        kots: unknown[];
        amount: number;
    }>;
    getOrderWithDetails(orderId: string): Promise<{
        order: Row;
        items: Row[];
        kots: {
            items: unknown[];
        }[];
        bills: Row[];
    } | null>;
    getOpenOrderForTable(liveTableId: string): Promise<{
        session: Row;
        order: null;
    } | {
        order?: Row | undefined;
        items?: Row[] | undefined;
        kots?: {
            items: unknown[];
        }[] | undefined;
        bills?: Row[] | undefined;
        session: Row;
    } | null>;
    printBill(billId: string): Promise<unknown>;
    printBillForOrder(orderId: string): Promise<unknown>;
    syncBillPaymentStatus(billId: string): Promise<unknown>;
    payBill(input: {
        billId: string;
        amount: number;
        paymentMethod?: string;
        externalReference?: string;
        receivedBy?: string;
        notes?: string;
    }): Promise<{
        bill: Row;
        order: unknown;
    }>;
    payBillFull(input: {
        billId: string;
        paymentMethod?: string;
        externalReference?: string;
        receivedBy?: string;
    }): Promise<{
        bill: Row;
        order: unknown;
    }>;
    payOrderLegacy(orderId: string, paymentMethod: string): Promise<{
        bill: Row;
        order: unknown;
    }>;
    advanceKot(kotId: string): Promise<unknown>;
    syncOrderStatusFromKots(orderId: string): Promise<string | null>;
    buildKotRow(kot: Row, orderById: Map<string, Row>): Promise<{
        id: string;
        kotNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        status: string;
        kotStatus: string;
        placedAt: string;
        createdAt: {} | null;
        printedAt: {} | null;
        prepMinutes: number | null;
        rejectReason: string | null;
        lines: {
            note?: string | undefined;
            id: string;
            name: string;
            qty: number;
            status: string;
        }[];
        amount: number;
    } | null>;
    listKots(outletId?: string): Promise<{
        id: string;
        kotNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        status: string;
        kotStatus: string;
        placedAt: string;
        createdAt: {} | null;
        printedAt: {} | null;
        prepMinutes: number | null;
        rejectReason: string | null;
        lines: {
            note?: string | undefined;
            id: string;
            name: string;
            qty: number;
            status: string;
        }[];
        amount: number;
    }[]>;
    acceptKot(kotId: string, prepMinutes?: number | null): Promise<{
        id: string;
        kotNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        status: string;
        kotStatus: string;
        placedAt: string;
        createdAt: {} | null;
        printedAt: {} | null;
        prepMinutes: number | null;
        rejectReason: string | null;
        lines: {
            note?: string | undefined;
            id: string;
            name: string;
            qty: number;
            status: string;
        }[];
        amount: number;
    }>;
    rejectKot(kotId: string, reason: string): Promise<{
        rejectReason: string;
        id: string;
        kotNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        status: string;
        kotStatus: string;
        placedAt: string;
        createdAt: {} | null;
        printedAt: {} | null;
        prepMinutes: number | null;
        lines: {
            note?: string | undefined;
            id: string;
            name: string;
            qty: number;
            status: string;
        }[];
        amount: number;
    }>;
    cancelKotItem(kotItemId: string, reason: string): Promise<{
        rejectReason: string;
        id: string;
        kotNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        status: string;
        kotStatus: string;
        placedAt: string;
        createdAt: {} | null;
        printedAt: {} | null;
        prepMinutes: number | null;
        lines: {
            note?: string | undefined;
            id: string;
            name: string;
            qty: number;
            status: string;
        }[];
        amount: number;
    }>;
    syncKitchenFromOrder(orderId: string, orderStatus: string): Promise<void>;
    listBills(outletId?: string): Promise<{
        id: string;
        billNo: string;
        orderId: string;
        orderNo: string;
        orderType: string;
        ref: string;
        guest: string;
        server: string;
        outletId: string;
        total: number;
        subtotal: number;
        tax: number;
        discount: number;
        status: string;
        paymentStatus: string;
        billPrintedAt: {} | null;
        createdAt: {} | null;
    }[]>;
    ACTIVE_KOT: Set<string>;
};
declare function deriveOrderStatusFromKots(kots: Row[]): string | null;
export { deriveOrderStatusFromKots, syncLegacyOrderLines, getOpenSessionForTable };

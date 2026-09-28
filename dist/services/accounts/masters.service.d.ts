import { type AccTable, type Row } from "../../models/accounts/repo.js";
type MasterConfig = {
    key: string;
    table: AccTable;
    label: string;
    columns: readonly string[];
    required: readonly string[];
    order: {
        column: string;
        ascending?: boolean;
    }[];
    filterable?: readonly string[];
    uppercase?: readonly string[];
    autoCode?: {
        field: string;
        prefix: string;
        pad: number;
    };
    defaults?: Row;
    validate?: (payload: Row, existing: Row | null) => Promise<void> | void;
    afterCreate?: (row: Row) => Promise<void>;
    afterSave?: (row: Row) => Promise<void>;
    beforeDelete?: (row: Row) => Promise<void>;
    enrich?: (rows: Row[]) => Promise<Row[]>;
};
/** Open bill balances per party (bill amount minus settlements). */
export declare function partyOutstandingMap(): Promise<Map<string, {
    receivable: number;
    payable: number;
    openBills: number;
}>>;
export declare const masters: Record<string, MasterConfig>;
export declare function listMaster(cfg: MasterConfig, query: Record<string, unknown>): Promise<Row[]>;
export declare function getMaster(cfg: MasterConfig, id: string): Promise<Row>;
export declare function createMaster(cfg: MasterConfig, body: Row): Promise<Row>;
export declare function updateMaster(cfg: MasterConfig, id: string, body: Row): Promise<Row>;
export declare function deleteMaster(cfg: MasterConfig, id: string): Promise<{
    id: string;
}>;
export {};

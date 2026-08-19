export type FilterMap = Record<string, string | number | boolean | undefined>;
export declare function listRows<T>(table: string, options?: {
    filters?: FilterMap;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
}): Promise<T[]>;
export declare function getRowById<T>(table: string, id: string, idColumn?: string): Promise<T | null>;
export declare function insertRow<T>(table: string, payload: Record<string, unknown>): Promise<T>;
export declare function updateRow<T>(table: string, id: string, payload: Record<string, unknown>, idColumn?: string): Promise<T>;
export declare function deleteRow(table: string, id: string, idColumn?: string): Promise<void>;
/** Generate a UUID v4 primary key. Prefix is kept for call-site compatibility only. */
export declare function newId(_prefix?: string): string;
/** Human-readable document / ticket number (not a primary key). */
export declare function newCode(prefix: string): string;

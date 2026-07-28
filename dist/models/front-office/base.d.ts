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
export declare function newId(prefix: string): string;

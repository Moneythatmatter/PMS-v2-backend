type CodeField = {
    key: string;
    prefix: string;
};
/** Fill missing human-readable document codes before SM inserts. */
export declare function ensureSmCodes(body: Record<string, unknown>, fields: CodeField[]): Record<string, unknown>;
export {};

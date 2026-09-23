/** Document helpers for Engineering Maintenance (mnt_*) tables. */
export declare function withMntDocumentDefaults(body: Record<string, unknown>, options: {
    numberField: string;
    prefix: string;
    dateDefaults?: Record<string, string>;
}): Record<string, unknown>;
type DocPackOptions = {
    /** Scalar columns mirrored outside payload for filtering / indexes. */
    filterKeys: string[];
};
/** Pack FE entity into filter columns + full payload jsonb. */
export declare function packMntDocument(body: Record<string, unknown>, options: DocPackOptions): Record<string, unknown>;
/** Unpack DB row into FE entity (payload merged with filter columns). */
export declare function unpackMntDocument<T extends Record<string, unknown>>(row: T): T;
export {};

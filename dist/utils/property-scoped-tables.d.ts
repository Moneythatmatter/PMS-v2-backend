/** Tables that must be filtered by property_id when a workspace context is active. */
export declare const PROPERTY_SCOPED_TABLES: Set<string>;
export declare function isPropertyScopedTable(table: string): boolean;

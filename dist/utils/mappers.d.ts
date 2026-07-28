/** Convert snake_case object keys to camelCase (one level + nested objects/arrays). */
export declare function toCamel<T = unknown>(input: unknown): T;
/** Convert camelCase object keys to snake_case (one level). */
export declare function toSnake(input: Record<string, unknown>): Record<string, unknown>;

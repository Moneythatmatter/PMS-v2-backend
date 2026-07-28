/** Convert snake_case object keys to camelCase (one level + nested objects/arrays). */
export function toCamel(input) {
    if (Array.isArray(input)) {
        return input.map((item) => toCamel(item));
    }
    if (input !== null && typeof input === "object" && !(input instanceof Date)) {
        const result = {};
        for (const [key, value] of Object.entries(input)) {
            const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            result[camelKey] = toCamel(value);
        }
        return result;
    }
    return input;
}
/** Convert camelCase object keys to snake_case (one level). */
export function toSnake(input) {
    const result = {};
    for (const [key, value] of Object.entries(input)) {
        const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        if (value !== undefined) {
            result[snakeKey] = value;
        }
    }
    return result;
}
//# sourceMappingURL=mappers.js.map
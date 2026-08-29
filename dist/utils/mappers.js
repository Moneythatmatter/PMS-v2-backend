/** Convert snake_case object keys to camelCase (one level + nested objects/arrays). */
const SNAKE_TO_CAMEL_OVERRIDES = {
    linked_pr: "linkedPR",
    linked_rfq: "linkedRFQ",
};
function snakeKeyToCamel(key) {
    if (SNAKE_TO_CAMEL_OVERRIDES[key])
        return SNAKE_TO_CAMEL_OVERRIDES[key];
    return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
export function toCamel(input) {
    if (Array.isArray(input)) {
        return input.map((item) => toCamel(item));
    }
    if (input !== null && typeof input === "object" && !(input instanceof Date)) {
        const result = {};
        for (const [key, value] of Object.entries(input)) {
            result[snakeKeyToCamel(key)] = toCamel(value);
        }
        return result;
    }
    return input;
}
/** Convert camelCase object keys to snake_case (one level). */
const CAMEL_TO_SNAKE_OVERRIDES = {
    linkedPR: "linked_pr",
    linkedRFQ: "linked_rfq",
};
export function toSnake(input) {
    const result = {};
    for (const [key, value] of Object.entries(input)) {
        const snakeKey = CAMEL_TO_SNAKE_OVERRIDES[key] ??
            key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        if (value !== undefined) {
            result[snakeKey] = value;
        }
    }
    return result;
}
//# sourceMappingURL=mappers.js.map
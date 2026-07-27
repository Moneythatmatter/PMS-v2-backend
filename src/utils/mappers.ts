/** Convert snake_case object keys to camelCase (one level + nested objects/arrays). */
export function toCamel<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((item) => toCamel(item)) as T;
  }
  if (input !== null && typeof input === "object" && !(input instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = toCamel(value);
    }
    return result as T;
  }
  return input as T;
}

/** Convert camelCase object keys to snake_case (one level). */
export function toSnake(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (value !== undefined) {
      result[snakeKey] = value;
    }
  }
  return result;
}

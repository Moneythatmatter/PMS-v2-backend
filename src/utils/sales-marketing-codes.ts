import { newCode } from "../models/front-office/base.js";

type CodeField = { key: string; prefix: string };

/** Fill missing human-readable document codes before SM inserts. */
export function ensureSmCodes(
  body: Record<string, unknown>,
  fields: CodeField[],
): Record<string, unknown> {
  const out = { ...body };
  for (const { key, prefix } of fields) {
    const value = out[key];
    if (value == null || String(value).trim() === "") {
      out[key] = newCode(prefix);
    }
  }
  return out;
}

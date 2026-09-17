import { newCode } from "../models/front-office/base.js";
/** Fill missing human-readable document codes before SM inserts. */
export function ensureSmCodes(body, fields) {
    const out = { ...body };
    for (const { key, prefix } of fields) {
        const value = out[key];
        if (value == null || String(value).trim() === "") {
            out[key] = newCode(prefix);
        }
    }
    return out;
}
//# sourceMappingURL=sales-marketing-codes.js.map
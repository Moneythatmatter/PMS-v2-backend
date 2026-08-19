import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
export async function listRows(table, options) {
    let query = supabase.from(table).select("*");
    if (options?.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
            if (value !== undefined && value !== "") {
                query = query.eq(key, value);
            }
        }
    }
    if (options?.orderBy) {
        query = query.order(options.orderBy, {
            ascending: options.ascending ?? true,
        });
    }
    if (options?.limit) {
        query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    return toCamel(data ?? []);
}
export async function getRowById(table, id, idColumn = "id") {
    const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq(idColumn, id)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? toCamel(data) : null;
}
/** Drop columns PostgREST reports as missing (stale / unpatched schema). */
function stripMissingColumn(payload, message) {
    const match = message.match(/Could not find the '([^']+)' column of '[^']+' in the schema cache/i);
    if (!match)
        return false;
    const col = match[1];
    if (!(col in payload))
        return false;
    delete payload[col];
    return true;
}
export async function insertRow(table, payload) {
    const row = toSnake(payload);
    for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await supabase
            .from(table)
            .insert(row)
            .select()
            .single();
        if (!error)
            return toCamel(data);
        if (!stripMissingColumn(row, error.message)) {
            throwIfRlsError(error.message);
        }
    }
    throw new Error(`Insert into ${table} failed after stripping unknown columns`);
}
export async function updateRow(table, id, payload, idColumn = "id") {
    const row = toSnake(payload);
    for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await supabase
            .from(table)
            .update(row)
            .eq(idColumn, id)
            .select()
            .maybeSingle();
        if (!error)
            return toCamel(data ?? {});
        if (!stripMissingColumn(row, error.message)) {
            throwIfRlsError(error.message);
        }
    }
    throw new Error(`Update on ${table} failed after stripping unknown columns`);
}
export async function deleteRow(table, id, idColumn = "id") {
    const { error } = await supabase.from(table).delete().eq(idColumn, id);
    if (error)
        throw new Error(error.message);
}
/** Generate a UUID v4 primary key. Prefix is kept for call-site compatibility only. */
export function newId(_prefix) {
    return crypto.randomUUID();
}
/** Human-readable document / ticket number (not a primary key). */
export function newCode(prefix) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
//# sourceMappingURL=base.js.map
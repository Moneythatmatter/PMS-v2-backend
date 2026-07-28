import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
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
export async function insertRow(table, payload) {
    const { data, error } = await supabase
        .from(table)
        .insert(toSnake(payload))
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return toCamel(data);
}
export async function updateRow(table, id, payload, idColumn = "id") {
    const { data, error } = await supabase
        .from(table)
        .update(toSnake(payload))
        .eq(idColumn, id)
        .select()
        .single();
    if (error)
        throw new Error(error.message);
    return toCamel(data);
}
export async function deleteRow(table, id, idColumn = "id") {
    const { error } = await supabase.from(table).delete().eq(idColumn, id);
    if (error)
        throw new Error(error.message);
}
export function newId(prefix) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
//# sourceMappingURL=base.js.map
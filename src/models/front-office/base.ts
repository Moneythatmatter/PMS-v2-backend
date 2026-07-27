import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";

export type FilterMap = Record<string, string | number | boolean | undefined>;

export async function listRows<T>(
  table: string,
  options?: {
    filters?: FilterMap;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
  },
): Promise<T[]> {
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
  if (error) throw new Error(error.message);
  return toCamel<T[]>(data ?? []);
}

export async function getRowById<T>(
  table: string,
  id: string,
  idColumn = "id",
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(idColumn, id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toCamel<T>(data) : null;
}

export async function insertRow<T>(
  table: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .insert(toSnake(payload))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return toCamel<T>(data);
}

export async function updateRow<T>(
  table: string,
  id: string,
  payload: Record<string, unknown>,
  idColumn = "id",
): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .update(toSnake(payload))
    .eq(idColumn, id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return toCamel<T>(data);
}

export async function deleteRow(
  table: string,
  id: string,
  idColumn = "id",
): Promise<void> {
  const { error } = await supabase.from(table).delete().eq(idColumn, id);
  if (error) throw new Error(error.message);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

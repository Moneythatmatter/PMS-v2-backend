import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";

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

/** Drop columns PostgREST reports as missing (stale / unpatched schema). */
function stripMissingColumn(
  payload: Record<string, unknown>,
  message: string,
): boolean {
  const match = message.match(
    /Could not find the '([^']+)' column of '[^']+' in the schema cache/i,
  );
  if (!match) return false;
  const col = match[1];
  if (!(col in payload)) return false;
  delete payload[col];
  return true;
}

export async function insertRow<T>(
  table: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const row = toSnake(payload) as Record<string, unknown>;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single();

    if (!error) return toCamel<T>(data);
    if (!stripMissingColumn(row, error.message)) {
      throwIfRlsError(error.message);
    }
  }
  throw new Error(`Insert into ${table} failed after stripping unknown columns`);
}

export async function updateRow<T>(
  table: string,
  id: string,
  payload: Record<string, unknown>,
  idColumn = "id",
): Promise<T> {
  const row = toSnake(payload) as Record<string, unknown>;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .update(row)
      .eq(idColumn, id)
      .select()
      .maybeSingle();

    if (!error) return toCamel<T>(data ?? ({} as T));
    if (!stripMissingColumn(row, error.message)) {
      throwIfRlsError(error.message);
    }
  }
  throw new Error(`Update on ${table} failed after stripping unknown columns`);
}

export async function deleteRow(
  table: string,
  id: string,
  idColumn = "id",
): Promise<void> {
  const { error } = await supabase.from(table).delete().eq(idColumn, id);
  if (error) throw new Error(error.message);
}

/** Generate a UUID v4 primary key. Prefix is kept for call-site compatibility only. */
export function newId(_prefix?: string): string {
  return crypto.randomUUID();
}

/** Human-readable document / ticket number (not a primary key). */
export function newCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

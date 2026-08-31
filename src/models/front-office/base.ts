import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { isPropertyScopedTable } from "../../utils/property-scoped-tables.js";

export type FilterMap = Record<string, string | number | boolean | undefined>;

function mergePropertyFilter(
  table: string,
  filters: FilterMap = {},
): FilterMap {
  const propertyId = getActivePropertyId();
  if (propertyId && isPropertyScopedTable(table) && filters.property_id === undefined) {
    return { ...filters, property_id: propertyId };
  }
  return filters;
}

function injectPropertyOnWrite(
  table: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const propertyId = getActivePropertyId();
  if (propertyId && isPropertyScopedTable(table) && payload.propertyId == null && payload.property_id == null) {
    return { ...payload, propertyId };
  }
  return payload;
}

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

  const filters = mergePropertyFilter(table, options?.filters ?? {});
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      query = query.eq(key, value);
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
  let query = supabase.from(table).select("*").eq(idColumn, id);
  const propertyId = getActivePropertyId();
  if (propertyId && isPropertyScopedTable(table)) {
    query = query.eq("property_id", propertyId);
  }
  const { data, error } = await query.maybeSingle();

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
  const withProperty = injectPropertyOnWrite(table, payload);
  const row = toSnake(withProperty) as Record<string, unknown>;
  let lastError = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single();

    if (!error) return toCamel<T>(data);
    lastError = error.message;
    if (!stripMissingColumn(row, error.message)) {
      throwIfRlsError(error.message);
    }
  }
  throw new Error(
    `Insert into ${table} failed after stripping unknown columns: ${lastError}`,
  );
}

export async function updateRow<T>(
  table: string,
  id: string,
  payload: Record<string, unknown>,
  idColumn = "id",
): Promise<T> {
  const row = toSnake(payload) as Record<string, unknown>;
  for (let attempt = 0; attempt < 8; attempt++) {
    let query = supabase.from(table).update(row).eq(idColumn, id);
    const propertyId = getActivePropertyId();
    if (propertyId && isPropertyScopedTable(table)) {
      query = query.eq("property_id", propertyId);
    }
    const { data, error } = await query.select().maybeSingle();

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
  let query = supabase.from(table).delete().eq(idColumn, id);
  const propertyId = getActivePropertyId();
  if (propertyId && isPropertyScopedTable(table)) {
    query = query.eq("property_id", propertyId);
  }
  const { error } = await query;
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

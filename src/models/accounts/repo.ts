import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../../errors/index.js";

export const accTables = {
  currencies: "acc_currencies",
  companies: "acc_companies",
  companySettings: "acc_company_settings",
  fiscalYears: "acc_fiscal_years",
  fiscalPeriods: "acc_fiscal_periods",
  accounts: "acc_accounts",
  divisions: "acc_divisions",
  partyTypes: "acc_party_types",
  partySubTypes: "acc_party_sub_types",
  paymentMethods: "acc_payment_methods",
  parties: "acc_parties",
  voucherTypes: "acc_voucher_types",
  revenueCategories: "acc_revenue_categories",
  taxDefinitions: "acc_tax_definitions",
  taxRules: "acc_tax_rules",
  budgets: "acc_budgets",
  vouchers: "acc_vouchers",
  voucherLines: "acc_voucher_lines",
  partyBills: "acc_party_bills",
  billSettlements: "acc_bill_settlements",
  closingStock: "acc_closing_stock_items",
  coveringLetters: "acc_covering_letters",
  coveringLetterBills: "acc_covering_letter_bills",
  auditLogs: "acc_audit_logs",
} as const;

export type AccTable = (typeof accTables)[keyof typeof accTables];

export type Row = Record<string, any>;

type PgError = { message: string; code?: string; details?: string | null; hint?: string | null };

const PAGE_SIZE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function requireUuid(value: unknown, label = "id"): string {
  if (!isUuid(value)) throw new ValidationError(`Invalid ${label}`);
  return value;
}

export function propertyId(): string {
  const id = getActivePropertyId();
  if (!id) throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
  return id;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  acc_currencies_code_unique: "A currency with this code already exists",
  acc_companies_code_unique: "A company with this code already exists",
  acc_fiscal_years_code_unique: "A fiscal year with this code already exists",
  acc_fiscal_periods_no_unique: "This period number already exists for the fiscal year",
  acc_accounts_code_unique: "An account with this code already exists",
  acc_divisions_code_unique: "A division with this code already exists",
  acc_party_types_code_unique: "A party type with this code already exists",
  acc_party_sub_types_code_unique: "A party sub type with this code already exists",
  acc_payment_methods_code_unique: "A payment method with this code already exists",
  acc_parties_code_unique: "A party with this code already exists",
  acc_voucher_types_code_unique: "A voucher type with this short code already exists",
  acc_revenue_categories_code_unique: "A revenue category with this code already exists",
  acc_tax_definitions_code_unique: "A tax with this code already exists",
  acc_tax_rules_code_unique: "A tax rule with this code already exists",
  acc_budgets_unique: "A budget already exists for this division and fiscal year",
  acc_vouchers_no_unique: "This voucher number is already used",
  acc_party_bills_no_unique: "This bill number already exists for the party",
  acc_closing_stock_unique: "This item is already counted for the store on that valuation date",
  acc_covering_letters_no_unique: "This covering letter number is already used",
  acc_covering_letter_bills_unique: "Bill is already part of this covering letter",
  acc_company_settings_company_unique: "Settings already exist for this company",
};

function mapDbError(error: PgError, table: string): never {
  const msg = error.message ?? "Database error";
  if (error.code === "23505") {
    const constraint = msg.match(/constraint "([^"]+)"/)?.[1] ?? "";
    throw new ConflictError(UNIQUE_MESSAGES[constraint] ?? "Duplicate record");
  }
  if (error.code === "23503") {
    if (/update or delete/i.test(msg)) {
      throw new ConflictError("This record is used by other records and cannot be deleted");
    }
    throw new ValidationError("A referenced record does not exist");
  }
  if (error.code === "23514") throw new ValidationError(`Invalid value (${error.message})`);
  if (error.code === "22P02") throw new ValidationError("Invalid identifier or value format");
  if (error.code === "42P01" || /schema cache/i.test(msg)) {
    throw new AppError(
      `Accounts table "${table}" is missing. Run backend/sql/accounts-schema.sql in Supabase.`,
      500,
      "SCHEMA_MISSING",
    );
  }
  throw new AppError(msg, 500, "DATABASE_ERROR");
}

export type ListOptions = {
  eq?: Record<string, string | number | boolean | null | undefined>;
  in?: Record<string, readonly (string | number)[] | undefined>;
  gte?: Record<string, string | number | undefined>;
  lte?: Record<string, string | number | undefined>;
  order?: { column: string; ascending?: boolean }[];
  select?: string;
  limit?: number;
};

/** Property-scoped select. Pages through results so large ledgers are not truncated at 1000 rows. */
export async function list<T = Row>(table: AccTable, opts: ListOptions = {}): Promise<T[]> {
  const pid = propertyId();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase.from(table).select(opts.select ?? "*").eq("property_id", pid);
    for (const [k, v] of Object.entries(opts.eq ?? {})) {
      if (v === undefined) continue;
      q = v === null ? q.is(k, null) : q.eq(k, v);
    }
    for (const [k, v] of Object.entries(opts.in ?? {})) {
      if (!v) continue;
      if (v.length === 0) return [];
      q = q.in(k, v as (string | number)[]);
    }
    for (const [k, v] of Object.entries(opts.gte ?? {})) if (v !== undefined && v !== "") q = q.gte(k, v);
    for (const [k, v] of Object.entries(opts.lte ?? {})) if (v !== undefined && v !== "") q = q.lte(k, v);
    for (const o of opts.order ?? []) q = q.order(o.column, { ascending: o.ascending ?? true });
    if (!(opts.order ?? []).some((o) => o.column === "id")) q = q.order("id", { ascending: true });

    const pageEnd = opts.limit ? Math.min(from + PAGE_SIZE, opts.limit) - 1 : from + PAGE_SIZE - 1;
    const { data, error } = await q.range(from, pageEnd);
    if (error) mapDbError(error, table);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < pageEnd - from + 1) break;
    if (opts.limit && out.length >= opts.limit) break;
  }
  return toCamel<T[]>(out);
}

export async function getById<T = Row>(table: AccTable, id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("property_id", propertyId())
    .eq("id", id)
    .maybeSingle();
  if (error) mapDbError(error, table);
  return data ? toCamel<T>(data) : null;
}

export async function mustGet<T = Row>(table: AccTable, id: string, label = "Record"): Promise<T> {
  const row = await getById<T>(table, id);
  if (!row) throw new NotFoundError(`${label} not found`);
  return row;
}

export async function insert<T = Row>(table: AccTable, payload: Row): Promise<T> {
  const row = toSnake({ ...payload, propertyId: propertyId() }) as Row;
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) mapDbError(error, table);
  return toCamel<T>(data);
}

export async function insertMany<T = Row>(table: AccTable, payloads: Row[]): Promise<T[]> {
  if (payloads.length === 0) return [];
  const pid = propertyId();
  const rows = payloads.map((p) => toSnake({ ...p, propertyId: pid }) as Row);
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) mapDbError(error, table);
  return toCamel<T[]>(data ?? []);
}

export async function update<T = Row>(table: AccTable, id: string, payload: Row): Promise<T> {
  requireUuid(id);
  const row = toSnake(payload) as Row;
  delete row.id;
  delete row.property_id;
  const { data, error } = await supabase
    .from(table)
    .update(row)
    .eq("property_id", propertyId())
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) mapDbError(error, table);
  if (!data) throw new NotFoundError("Record not found");
  return toCamel<T>(data);
}

export async function updateWhere(
  table: AccTable,
  payload: Row,
  where: { eq?: Record<string, string | number | boolean>; in?: Record<string, string[]> },
): Promise<number> {
  let q = supabase.from(table).update(toSnake(payload) as Row).eq("property_id", propertyId());
  for (const [k, v] of Object.entries(where.eq ?? {})) q = q.eq(k, v);
  for (const [k, v] of Object.entries(where.in ?? {})) {
    if (v.length === 0) return 0;
    q = q.in(k, v);
  }
  const { data, error } = await q.select("id");
  if (error) mapDbError(error, table);
  return (data ?? []).length;
}

export async function remove(table: AccTable, id: string): Promise<void> {
  requireUuid(id);
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .eq("property_id", propertyId())
    .eq("id", id);
  if (error) mapDbError(error, table);
  if (count === 0) throw new NotFoundError("Record not found");
}

export async function removeWhere(table: AccTable, eq: Record<string, string>): Promise<void> {
  let q = supabase.from(table).delete().eq("property_id", propertyId());
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  const { error } = await q;
  if (error) mapDbError(error, table);
}

export async function count(
  table: AccTable,
  eq: Record<string, string | number | boolean>,
  inFilter?: Record<string, string[]>,
): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("property_id", propertyId());
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  for (const [k, v] of Object.entries(inFilter ?? {})) {
    if (v.length === 0) return 0;
    q = q.in(k, v);
  }
  const { count: n, error } = await q;
  if (error) mapDbError(error, table);
  return n ?? 0;
}

const SERVER_MANAGED = new Set(["id", "propertyId", "createdAt", "updatedAt", "createdBy", "updatedBy"]);

/**
 * Keep only writable columns: drops server-managed keys, unknown keys (when `allowed` is given),
 * and converts empty strings on *Id / *Date fields to null so uuid/date columns accept them.
 */
export function cleanPayload(body: Row, allowed?: readonly string[]): Row {
  const out: Row = {};
  const allow = allowed ? new Set(allowed) : null;
  for (const [key, value] of Object.entries(body ?? {})) {
    if (SERVER_MANAGED.has(key) || value === undefined) continue;
    if (allow && !allow.has(key)) continue;
    if (value === "" && (/Id$/.test(key) || /Date$/.test(key) || /(At|From|To)$/.test(key))) {
      out[key] = null;
      continue;
    }
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

const actorCache = new Map<string, string>();

/** Display name of the signed-in user, used for created_by / posted_by / audit trails. */
export async function actorName(): Promise<string> {
  const userId = getRequestStore()?.userId;
  if (!userId) return "System";
  const cached = actorCache.get(userId);
  if (cached) return cached;
  const { data } = await supabase.from("users").select("name,email").eq("id", userId).maybeSingle();
  const name = (data?.name as string) || (data?.email as string) || "User";
  actorCache.set(userId, name);
  return name;
}

export async function audit(
  entityType: string,
  entityId: string | null,
  action: string,
  opts: { reason?: string | null; details?: Row } = {},
): Promise<void> {
  await insert(accTables.auditLogs, {
    entityType,
    entityId,
    action,
    actor: await actorName(),
    reason: opts.reason ?? null,
    details: opts.details ?? {},
  });
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

export function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

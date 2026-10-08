import { supabase } from "../../utils/supabase.js";
import { toCamel, toSnake } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { ValidationError } from "../../errors/index.js";
import { deleteRow, getRowById, insertRow, updateRow } from "../front-office/base.js";
import { psTables } from "./index.js";

const HEADER = psTables.purchaseRequisitions;
const ITEMS = psTables.purchaseRequisitionItems;
const IN_CHUNK = 150;
/** PostgREST caps responses (1000 rows on Supabase), so item reads page through. */
const PAGE = 1000;

export const SOURCE_MODULES = [
  "Front Office",
  "Housekeeping",
  "Food & Beverage",
  "Kitchen",
  "Maintenance",
  "Human Resources",
  "Accounts",
  "Sales & Marketing",
  "Security",
  "Purchase & Stores",
] as const;

/** Line item as exposed on `requestedItems` (shape the PR → RFQ → PO screens already use). */
export type RequisitionItem = {
  id: string;
  lineNo: number;
  materialId?: string;
  productCode?: string;
  item: string;
  category: string;
  quantity: number;
  unit: string;
  estimatedPrice: number;
  total: number;
  remarks?: string;
  approvedQty: number | null;
  orderedQty: number;
  receivedQty: number;
  stockOnHand: number | null;
  requiredDate?: string | null;
};

export type RequisitionHeader = {
  id: string;
  prNumber: string;
  sourceModule: string;
  status: string;
  currentApprover?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  [key: string]: unknown;
};

export type Requisition = RequisitionHeader & { requestedItems: RequisitionItem[] };

type ItemRow = {
  id: string;
  requisitionId: string;
  lineNo: number;
  materialId: string | null;
  productCode: string;
  itemName: string;
  category: string;
  unit: string;
  requestedQty: number;
  approvedQty: number | null;
  orderedQty: number;
  receivedQty: number;
  stockOnHand: number | null;
  estimatedRate: number;
  estimatedAmount: number;
  requiredDate: string | null;
  remarks: string;
};

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
const text = (v: unknown) => String(v ?? "").trim();

function toItem(row: ItemRow): RequisitionItem {
  const quantity = num(row.requestedQty);
  const estimatedPrice = num(row.estimatedRate);
  return {
    id: row.id,
    lineNo: row.lineNo,
    materialId: row.materialId ?? undefined,
    productCode: row.productCode || undefined,
    item: row.itemName,
    category: row.category,
    quantity,
    unit: row.unit,
    estimatedPrice,
    total: num(row.estimatedAmount, quantity * estimatedPrice),
    remarks: row.remarks || undefined,
    approvedQty: numOrNull(row.approvedQty),
    orderedQty: num(row.orderedQty),
    receivedQty: num(row.receivedQty),
    stockOnHand: numOrNull(row.stockOnHand),
    requiredDate: row.requiredDate,
  };
}

function chunks<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchItemRows(requisitionIds?: string[]): Promise<ItemRow[]> {
  if (requisitionIds && requisitionIds.length === 0) return [];
  const batches = requisitionIds ? chunks(requisitionIds) : [null];
  const rows: ItemRow[] = [];
  for (const batch of batches) {
    for (let from = 0; ; from += PAGE) {
      let query = supabase
        .from(ITEMS)
        .select("*")
        .order("requisition_id", { ascending: true })
        .order("line_no", { ascending: true })
        .range(from, from + PAGE - 1);
      if (batch) query = query.in("requisition_id", batch);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...toCamel<ItemRow[]>(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

/** Attach child rows as `requestedItems`. Pass `all` when `headers` is the full table. */
export async function attachItems<T extends { id: string }>(
  headers: T[],
  all = false,
): Promise<(T & { requestedItems: RequisitionItem[] })[]> {
  const rows = await fetchItemRows(all ? undefined : headers.map((h) => h.id));
  const byReq = new Map<string, RequisitionItem[]>();
  for (const row of rows) {
    const list = byReq.get(row.requisitionId) ?? [];
    list.push(toItem(row));
    byReq.set(row.requisitionId, list);
  }
  return headers.map((h) => ({ ...h, requestedItems: byReq.get(h.id) ?? [] }));
}

export async function listRequisitions(filters: {
  status?: string;
  department?: string;
  sourceModules?: string[];
} = {}): Promise<Requisition[]> {
  let query = supabase.from(HEADER).select("*").order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.department) query = query.eq("department", filters.department);
  if (filters.sourceModules?.length) query = query.in("source_module", filters.sourceModules);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const headers = toCamel<RequisitionHeader[]>(data ?? []);
  const filtered = Object.values(filters).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  return attachItems(headers, !filtered);
}

export async function getRequisition(id: string): Promise<Requisition | null> {
  const header = await getRowById<RequisitionHeader>(HEADER, id);
  if (!header) return null;
  const [withItems] = await attachItems([header]);
  return withItems;
}

export async function getRequisitionByNumber(prNumber: string): Promise<Requisition | null> {
  const { data, error } = await supabase.from(HEADER).select("*").eq("pr_number", prNumber).limit(1);
  if (error) throw new Error(error.message);
  const header = data?.[0] ? toCamel<RequisitionHeader>(data[0]) : null;
  if (!header) return null;
  const [withItems] = await attachItems([header]);
  return withItems;
}

// ── Writes ───────────────────────────────────────────────────────────────────

type ItemInput = {
  id?: string;
  materialId?: string;
  productCode?: string;
  item?: string;
  category?: string;
  quantity?: number | string;
  unit?: string;
  estimatedPrice?: number | string;
  approvedQty?: number | string | null;
  requiredDate?: string | null;
  remarks?: string;
};

type ProductRow = { id: string; productCode: string; productName: string; category: string; unit: string };

async function loadProducts(ids: string[]): Promise<Map<string, ProductRow>> {
  const map = new Map<string, ProductRow>();
  for (const batch of chunks(ids)) {
    const { data, error } = await supabase
      .from(psTables.products)
      .select("id, product_code, product_name, category, unit")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const p of toCamel<ProductRow[]>(data ?? [])) map.set(p.id, p);
  }
  return map;
}

async function loadStockOnHand(materialIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const batch of chunks(materialIds)) {
    const { data, error } = await supabase
      .from(psTables.stockBalances)
      .select("material_id, quantity")
      .in("material_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String(row.material_id);
      map.set(id, (map.get(id) ?? 0) + num(row.quantity));
    }
  }
  return map;
}

async function existingItemRows(requisitionId: string) {
  const { data, error } = await supabase
    .from(ITEMS)
    .select("id, material_id")
    .eq("requisition_id", requisitionId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [String(r.id), r.material_id as string | null]));
}

/** Validate incoming lines against the material master and build child-table rows. */
async function buildItemRows(requisitionId: string, raw: unknown, existing: Map<string, string | null>) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("Add at least one item to the requisition.", [
      { path: "requestedItems", message: "At least one item is required" },
    ]);
  }
  const inputs = raw as ItemInput[];
  const materialIds = [...new Set(inputs.map((i) => text(i.materialId)).filter(Boolean))];
  const [products, stock] = await Promise.all([loadProducts(materialIds), loadStockOnHand(materialIds)]);

  const details: { path: string; message: string }[] = [];
  const seenMaterials = new Set<string>();
  const rows = inputs.map((input, idx) => {
    const keepId = input.id && existing.has(String(input.id)) ? String(input.id) : crypto.randomUUID();
    const materialId = text(input.materialId);
    const product = materialId ? products.get(materialId) : undefined;
    const label = text(input.item) || product?.productName || `Item ${idx + 1}`;
    const legacyUnlinked = !materialId && existing.has(keepId) && !existing.get(keepId);

    if (materialId && !product) {
      details.push({ path: `requestedItems[${idx}].materialId`, message: `${label} is not in the material master` });
    } else if (!materialId && !legacyUnlinked) {
      details.push({ path: `requestedItems[${idx}].materialId`, message: `${label}: select the item from the material master` });
    }
    if (materialId) {
      if (seenMaterials.has(materialId)) {
        details.push({ path: `requestedItems[${idx}]`, message: `${label} is listed more than once` });
      }
      seenMaterials.add(materialId);
    }
    const quantity = num(input.quantity);
    if (quantity <= 0) {
      details.push({ path: `requestedItems[${idx}].quantity`, message: `${label}: quantity must be greater than 0` });
    }
    const estimatedRate = Math.max(0, num(input.estimatedPrice));
    const approvedQty = numOrNull(input.approvedQty);

    return {
      id: keepId,
      requisition_id: requisitionId,
      line_no: idx + 1,
      material_id: product?.id ?? null,
      product_code: product?.productCode ?? text(input.productCode),
      item_name: product?.productName ?? label,
      category: product?.category ?? text(input.category),
      unit: product?.unit ?? text(input.unit),
      requested_qty: quantity,
      approved_qty: approvedQty === null ? null : Math.max(0, approvedQty),
      stock_on_hand: product ? (stock.get(product.id) ?? 0) : null,
      estimated_rate: estimatedRate,
      required_date: text(input.requiredDate) || null,
      remarks: text(input.remarks),
      updated_at: new Date().toISOString(),
    };
  });

  if (details.length > 0) {
    throw new ValidationError(details.map((d) => d.message).join("; "), details);
  }
  const amount = rows.reduce((s, r) => s + r.requested_qty * r.estimated_rate, 0);
  return { rows, estimatedAmount: Math.round(amount * 100) / 100 };
}

async function writeItemRows(
  requisitionId: string,
  rows: { id: string }[],
  existing: Map<string, string | null>,
) {
  const { error } = await supabase.from(ITEMS).upsert(rows, { onConflict: "id" });
  if (error) throwIfRlsError(error.message);
  const keep = new Set(rows.map((r) => r.id));
  const removed = [...existing.keys()].filter((id) => !keep.has(id));
  for (const batch of chunks(removed)) {
    const { error: delError } = await supabase
      .from(ITEMS)
      .delete()
      .eq("requisition_id", requisitionId)
      .in("id", batch);
    if (delError) throw new Error(delError.message);
  }
}

/** Header-only fields from an API body (line items travel separately). */
function headerPayload(body: Record<string, unknown>) {
  const header = { ...body };
  delete header.id;
  delete header.requestedItems;
  delete header.items;
  delete header.estimatedAmount;
  return header;
}

function stampStatus(header: Record<string, unknown>, prev?: RequisitionHeader) {
  const status = header.status !== undefined ? String(header.status) : prev?.status;
  if (!status || status === prev?.status) return;
  const now = new Date().toISOString();
  if (status === "Pending Approval" && !prev?.submittedAt) header.submittedAt = now;
  if (status === "Approved") {
    header.approvedAt = now;
    header.approvedBy = text(header.approvedBy) || prev?.currentApprover || "Purchase Manager";
  }
}

export async function createRequisition(body: Record<string, unknown>): Promise<Requisition> {
  const header = headerPayload(body);
  const id = text(body.id) || crypto.randomUUID();
  const { rows, estimatedAmount } = await buildItemRows(id, body.requestedItems, new Map());
  stampStatus(header);
  await insertRow(HEADER, { ...header, id, estimatedAmount });
  try {
    await writeItemRows(id, rows, new Map());
  } catch (e) {
    await deleteRow(HEADER, id);
    throw e;
  }
  return (await getRequisition(id)) as Requisition;
}

export async function updateRequisition(
  id: string,
  body: Record<string, unknown>,
  prev: RequisitionHeader,
): Promise<Requisition> {
  const header: Record<string, unknown> = headerPayload(body);
  stampStatus(header, prev);
  if (body.requestedItems !== undefined) {
    const existing = await existingItemRows(id);
    const { rows, estimatedAmount } = await buildItemRows(id, body.requestedItems, existing);
    await writeItemRows(id, rows, existing);
    header.estimatedAmount = estimatedAmount;
  }
  if (Object.keys(header).length > 0) {
    await updateRow(HEADER, id, { ...header, updatedAt: new Date().toISOString() });
  }
  return (await getRequisition(id)) as Requisition;
}

export async function deleteRequisition(id: string) {
  await deleteRow(HEADER, id);
}

/** Persist sourcing / receiving progress computed from linked POs and GRNs. */
export async function saveItemProgress(
  items: RequisitionItem[],
  next: { id: string; orderedQty?: number; receivedQty?: number }[],
) {
  const current = new Map(items.map((i) => [i.id, i]));
  for (const change of next) {
    const prev = current.get(change.id);
    if (!prev) continue;
    const patch: Record<string, unknown> = {};
    if (change.orderedQty !== undefined && change.orderedQty !== prev.orderedQty) patch.orderedQty = change.orderedQty;
    if (change.receivedQty !== undefined && change.receivedQty !== prev.receivedQty) patch.receivedQty = change.receivedQty;
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase
      .from(ITEMS)
      .update(toSnake({ ...patch, updatedAt: new Date().toISOString() }))
      .eq("id", change.id);
    if (error) throw new Error(error.message);
  }
}

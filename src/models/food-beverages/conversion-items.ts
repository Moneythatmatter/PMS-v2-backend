import { ConflictError, ValidationError } from "../../errors/index.js";
import {
  deleteRow,
  getRowById,
  insertRow,
  listRows,
  newId,
  updateRow,
} from "../front-office/base.js";
import { fbTables } from "./index.js";
import { ensurePsProductForPrepared } from "./conversion-ps-bridge.js";

export const conversionItemTables = {
  items: "fb_conversion_items",
  lines: "fb_conversion_item_lines",
} as const;

export type ConversionItemLine = {
  id: string;
  conversionItemId: string;
  lineNo: number;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  qty: number;
  uom: string;
};

export type ConversionItem = {
  id: string;
  code: string;
  name: string;
  outputIngredientId: string;
  /** PS material used by recipes / POS stock deduction. */
  psProductId: string;
  outputName: string;
  yieldQty: number;
  yieldUom: string;
  notes: string;
  status: "Active" | "Inactive";
  lines: ConversionItemLine[];
  createdAt: string;
  updatedAt: string;
};

type IngredientRow = {
  id: string;
  code?: string;
  name: string;
  uom?: string;
  onHand?: number;
  kind?: string;
  status?: string;
  reorder?: number;
};

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(n: number, places = 4) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

type LineInput = { ingredientId?: string; qty?: number | string; uom?: string };

function normalizeLines(raw: unknown): Array<{ ingredientId: string; qty: number; uom?: string }> {
  if (!Array.isArray(raw)) return [];
  return (raw as LineInput[])
    .map((l) => ({
      ingredientId: String(l.ingredientId ?? "").trim(),
      qty: num(l.qty),
      uom: l.uom ? String(l.uom) : undefined,
    }))
    .filter((l) => l.ingredientId && l.qty > 0);
}

async function loadLines(conversionItemId: string): Promise<ConversionItemLine[]> {
  const rows = await listRows<ConversionItemLine>(conversionItemTables.lines, {
    filters: { conversion_item_id: conversionItemId },
    orderBy: "line_no",
    ascending: true,
  });
  return rows.map((r) => ({
    ...r,
    lineNo: num(r.lineNo) || 1,
    qty: num(r.qty),
  }));
}

async function toItem(header: Record<string, unknown>): Promise<ConversionItem> {
  const id = String(header.id);
  const lines = await loadLines(id);
  return {
    id,
    code: String(header.code ?? ""),
    name: String(header.name ?? ""),
    outputIngredientId: String(header.outputIngredientId ?? ""),
    psProductId: String(header.psProductId ?? ""),
    outputName: String(header.outputName ?? header.name ?? ""),
    yieldQty: num(header.yieldQty) || 1,
    yieldUom: String(header.yieldUom ?? "Kg"),
    notes: String(header.notes ?? ""),
    status: (String(header.status ?? "Active") as ConversionItem["status"]) || "Active",
    lines,
    createdAt: String(header.createdAt ?? ""),
    updatedAt: String(header.updatedAt ?? ""),
  };
}

/** Find prepared ingredient by name, or create one. */
export async function resolvePreparedIngredient(opts: {
  name: string;
  uom?: string;
  outputIngredientId?: string;
}): Promise<IngredientRow> {
  const name = opts.name.trim();
  if (!name) throw new ValidationError("Enter the conversion item name.");

  if (opts.outputIngredientId) {
    const byId = await getRowById<IngredientRow>(fbTables.ingredients, opts.outputIngredientId);
    if (byId) {
      const updates: Record<string, unknown> = {};
      if (String(byId.name ?? "").trim().toLowerCase() !== name.toLowerCase()) updates.name = name;
      if (opts.uom && opts.uom !== byId.uom) updates.uom = opts.uom;
      if (String(byId.kind ?? "").toLowerCase() !== "prepared") updates.kind = "prepared";
      if (Object.keys(updates).length) {
        return (await updateRow<IngredientRow>(fbTables.ingredients, byId.id, updates)) as IngredientRow;
      }
      return byId;
    }
  }

  const all = await listRows<IngredientRow>(fbTables.ingredients, {});
  const needle = name.toLowerCase();
  const match =
    all.find(
      (i) =>
        String(i.name ?? "").trim().toLowerCase() === needle &&
        String(i.kind ?? "").toLowerCase() === "prepared",
    ) || all.find((i) => String(i.name ?? "").trim().toLowerCase() === needle);

  if (match) {
    const updates: Record<string, unknown> = {};
    if (String(match.kind ?? "").toLowerCase() !== "prepared") updates.kind = "prepared";
    if (opts.uom && opts.uom !== match.uom) updates.uom = opts.uom;
    if (Object.keys(updates).length) {
      return (await updateRow<IngredientRow>(fbTables.ingredients, match.id, updates)) as IngredientRow;
    }
    return match;
  }

  const uom = (opts.uom || "Kg").trim() || "Kg";
  return insertRow<IngredientRow>(fbTables.ingredients, {
    id: newId("ING"),
    code: `PREP-${Date.now().toString(36).toUpperCase()}`,
    name,
    kind: "prepared",
    uom,
    onHand: 0,
    reorder: 0,
    status: "Active",
  });
}

async function replaceLines(
  conversionItemId: string,
  lines: Array<{ ingredientId: string; qty: number; uom?: string }>,
  outputIngredientId: string,
) {
  const existing = await listRows<{ id: string }>(conversionItemTables.lines, {
    filters: { conversion_item_id: conversionItemId },
  });
  for (const row of existing) await deleteRow(conversionItemTables.lines, row.id);

  const ingredients = await listRows<IngredientRow>(fbTables.ingredients, {});
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  let lineNo = 1;
  for (const line of lines) {
    if (line.ingredientId === outputIngredientId) {
      throw new ValidationError("An ingredient cannot be both an input and the prepared output.");
    }
    const ing = byId.get(line.ingredientId);
    if (!ing) throw new ValidationError(`Ingredient ${line.ingredientId} was not found.`);
    await insertRow(conversionItemTables.lines, {
      id: newId("CIL"),
      conversionItemId,
      lineNo: lineNo++,
      ingredientId: ing.id,
      ingredientCode: String(ing.code ?? ""),
      ingredientName: String(ing.name ?? ""),
      qty: round(line.qty),
      uom: line.uom || String(ing.uom ?? ""),
    });
  }
}

export async function listConversionItems(): Promise<ConversionItem[]> {
  const headers = await listRows<Record<string, unknown>>(conversionItemTables.items, {
    orderBy: "name",
    ascending: true,
  });
  return Promise.all(headers.map((h) => toItem(h)));
}

export async function getConversionItem(id: string): Promise<ConversionItem | null> {
  const header = await getRowById<Record<string, unknown>>(conversionItemTables.items, id);
  if (!header) return null;
  return toItem(header);
}

export async function createConversionItem(body: Record<string, unknown>): Promise<ConversionItem> {
  const name = String(body.name ?? body.outputName ?? "").trim();
  const yieldQty = num(body.yieldQty);
  const yieldUom = String(body.yieldUom ?? "Kg").trim() || "Kg";
  const lines = normalizeLines(body.lines);

  if (!name) throw new ValidationError("Enter the conversion item name.");
  if (!(yieldQty > 0)) throw new ValidationError("Yield quantity must be greater than 0.");
  if (lines.length === 0) throw new ValidationError("Add at least one ingredient for this conversion item.");

  const output = await resolvePreparedIngredient({
    name,
    uom: yieldUom,
    outputIngredientId: String(body.outputIngredientId ?? "").trim() || undefined,
  });
  const code = String(body.code ?? "").trim() || `CI-${Date.now().toString(36).toUpperCase()}`;
  const psProduct = await ensurePsProductForPrepared({
    name,
    uom: yieldUom,
    code,
    existingPsProductId: String(body.psProductId ?? "").trim() || undefined,
  });

  const id = newId("CIM");
  const header = await insertRow<Record<string, unknown>>(conversionItemTables.items, {
    id,
    code,
    name,
    outputIngredientId: output.id,
    psProductId: psProduct.id,
    outputName: String(output.name ?? name),
    yieldQty: round(yieldQty),
    yieldUom,
    notes: String(body.notes ?? ""),
    status: String(body.status ?? "Active") === "Inactive" ? "Inactive" : "Active",
  });
  await replaceLines(id, lines, output.id);
  return toItem(header);
}

export async function updateConversionItem(id: string, body: Record<string, unknown>): Promise<ConversionItem> {
  const prev = await getConversionItem(id);
  if (!prev) throw new ValidationError("Conversion item not found.");

  const name = String(body.name ?? prev.name).trim();
  const yieldQty = body.yieldQty !== undefined ? num(body.yieldQty) : prev.yieldQty;
  const yieldUom = String(body.yieldUom ?? prev.yieldUom).trim() || "Kg";
  const lines =
    body.lines !== undefined
      ? normalizeLines(body.lines)
      : prev.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, uom: l.uom }));

  if (!name) throw new ValidationError("Enter the conversion item name.");
  if (!(yieldQty > 0)) throw new ValidationError("Yield quantity must be greater than 0.");
  if (lines.length === 0) throw new ValidationError("Add at least one ingredient for this conversion item.");

  const output = await resolvePreparedIngredient({
    name,
    uom: yieldUom,
    outputIngredientId: String(body.outputIngredientId ?? prev.outputIngredientId).trim() || undefined,
  });
  const psProduct = await ensurePsProductForPrepared({
    name,
    uom: yieldUom,
    code: prev.code,
    existingPsProductId: prev.psProductId || undefined,
  });

  const header = await updateRow<Record<string, unknown>>(conversionItemTables.items, id, {
    name,
    outputIngredientId: output.id,
    psProductId: psProduct.id,
    outputName: String(output.name ?? name),
    yieldQty: round(yieldQty),
    yieldUom,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    status:
      body.status !== undefined
        ? String(body.status) === "Inactive"
          ? "Inactive"
          : "Active"
        : prev.status,
    updatedAt: new Date().toISOString(),
  });
  await replaceLines(id, lines, output.id);
  return toItem(header as Record<string, unknown>);
}

export async function deleteConversionItem(id: string): Promise<void> {
  const prev = await getConversionItem(id);
  if (!prev) throw new ValidationError("Conversion item not found.");

  const batches = await listRows<{ id: string; status?: string }>("fb_conversions", {
    filters: { conversion_item_id: id },
  });
  if (batches.some((b) => String(b.status) === "Completed")) {
    throw new ConflictError(
      `${prev.name} has completed stock batches. Set it Inactive instead of deleting.`,
    );
  }
  for (const b of batches) {
    const lines = await listRows<{ id: string }>("fb_conversion_lines", {
      filters: { conversion_id: b.id },
    });
    for (const line of lines) await deleteRow("fb_conversion_lines", line.id);
    await deleteRow("fb_conversions", b.id);
  }

  const masterLines = await listRows<{ id: string }>(conversionItemTables.lines, {
    filters: { conversion_item_id: id },
  });
  for (const line of masterLines) await deleteRow(conversionItemTables.lines, line.id);
  await deleteRow(conversionItemTables.items, id);
}

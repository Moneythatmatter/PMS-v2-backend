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
import { getConversionItem } from "./conversion-items.js";
import { creditPreparedPsStock, ensurePsProductForPrepared } from "./conversion-ps-bridge.js";

export const conversionTables = {
  conversions: "fb_conversions",
  lines: "fb_conversion_lines",
} as const;

export type ConversionLine = {
  id: string;
  conversionId: string;
  lineNo: number;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  qty: number;
  uom: string;
};

export type Conversion = {
  id: string;
  conversionNo: string;
  conversionDate: string;
  conversionItemId: string;
  outputIngredientId: string;
  outputName: string;
  outputQty: number;
  outputUom: string;
  notes: string;
  status: "Draft" | "Completed" | "Cancelled";
  completedAt: string | null;
  completedBy: string;
  lines: ConversionLine[];
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
};

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(n: number, places = 3) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

function nextConversionNo() {
  return `CNV-${Date.now().toString(36).toUpperCase()}`;
}

async function loadLines(conversionId: string): Promise<ConversionLine[]> {
  const rows = await listRows<ConversionLine>(conversionTables.lines, {
    filters: { conversion_id: conversionId },
    orderBy: "line_no",
    ascending: true,
  });
  return rows.map((r) => ({
    ...r,
    lineNo: num(r.lineNo) || 1,
    qty: num(r.qty),
  }));
}

async function toConversion(header: Record<string, unknown>): Promise<Conversion> {
  const id = String(header.id);
  const lines = await loadLines(id);
  return {
    id,
    conversionNo: String(header.conversionNo ?? ""),
    conversionDate: String(header.conversionDate ?? ""),
    conversionItemId: String(header.conversionItemId ?? ""),
    outputIngredientId: String(header.outputIngredientId ?? ""),
    outputName: String(header.outputName ?? ""),
    outputQty: num(header.outputQty),
    outputUom: String(header.outputUom ?? ""),
    notes: String(header.notes ?? ""),
    status: (String(header.status ?? "Draft") as Conversion["status"]) || "Draft",
    completedAt: header.completedAt ? String(header.completedAt) : null,
    completedBy: String(header.completedBy ?? ""),
    lines,
    createdAt: String(header.createdAt ?? ""),
    updatedAt: String(header.updatedAt ?? ""),
  };
}

async function replaceScaledLines(
  conversionId: string,
  masterLines: Array<{ ingredientId: string; ingredientCode: string; ingredientName: string; qty: number; uom: string }>,
  scale: number,
) {
  const existing = await listRows<{ id: string }>(conversionTables.lines, {
    filters: { conversion_id: conversionId },
  });
  for (const row of existing) await deleteRow(conversionTables.lines, row.id);

  let lineNo = 1;
  for (const line of masterLines) {
    const qty = round(line.qty * scale);
    if (!(qty > 0)) continue;
    await insertRow(conversionTables.lines, {
      id: newId("CVL"),
      conversionId,
      lineNo: lineNo++,
      ingredientId: line.ingredientId,
      ingredientCode: line.ingredientCode,
      ingredientName: line.ingredientName,
      qty,
      uom: line.uom,
    });
  }
}

export async function listConversions(): Promise<Conversion[]> {
  const headers = await listRows<Record<string, unknown>>(conversionTables.conversions, {
    orderBy: "created_at",
    ascending: false,
  });
  return Promise.all(headers.map((h) => toConversion(h)));
}

export async function getConversion(id: string): Promise<Conversion | null> {
  const header = await getRowById<Record<string, unknown>>(conversionTables.conversions, id);
  if (!header) return null;
  return toConversion(header);
}

/** Create a stock/production batch from a conversion item master. */
export async function createConversion(body: Record<string, unknown>): Promise<Conversion> {
  const conversionItemId = String(body.conversionItemId ?? "").trim();
  if (!conversionItemId) throw new ValidationError("Select a conversion item.");

  const item = await getConversionItem(conversionItemId);
  if (!item) throw new ValidationError("Conversion item was not found.");
  if (item.status !== "Active") throw new ValidationError(`${item.name} is inactive.`);
  if (item.lines.length === 0) throw new ValidationError(`${item.name} has no ingredients defined.`);

  const outputQty = body.outputQty !== undefined ? num(body.outputQty) : item.yieldQty;
  if (!(outputQty > 0)) throw new ValidationError("Quantity to produce must be greater than 0.");

  const scale = outputQty / item.yieldQty;
  if (!(scale > 0)) throw new ValidationError("Invalid produce quantity relative to yield.");

  const id = newId("CNV");
  const header = await insertRow<Record<string, unknown>>(conversionTables.conversions, {
    id,
    conversionNo: String(body.conversionNo ?? "").trim() || nextConversionNo(),
    conversionDate: String(body.conversionDate ?? "").trim() || todayISO(),
    conversionItemId: item.id,
    outputIngredientId: item.outputIngredientId,
    outputName: item.outputName || item.name,
    outputQty: round(outputQty),
    outputUom: item.yieldUom,
    notes: String(body.notes ?? ""),
    status: "Draft",
    completedBy: "",
  });
  await replaceScaledLines(id, item.lines, scale);
  return toConversion(header);
}

export async function updateConversion(id: string, body: Record<string, unknown>): Promise<Conversion> {
  const prev = await getConversion(id);
  if (!prev) throw new ValidationError("Conversion not found.");
  if (prev.status !== "Draft") throw new ConflictError(`${prev.conversionNo} is ${prev.status} and cannot be edited.`);

  const conversionItemId = String(body.conversionItemId ?? prev.conversionItemId).trim();
  const item = await getConversionItem(conversionItemId);
  if (!item) throw new ValidationError("Conversion item was not found.");
  if (item.lines.length === 0) throw new ValidationError(`${item.name} has no ingredients defined.`);

  const outputQty = body.outputQty !== undefined ? num(body.outputQty) : prev.outputQty;
  if (!(outputQty > 0)) throw new ValidationError("Quantity to produce must be greater than 0.");

  const scale = outputQty / item.yieldQty;

  const header = await updateRow<Record<string, unknown>>(conversionTables.conversions, id, {
    conversionDate: String(body.conversionDate ?? prev.conversionDate),
    conversionItemId: item.id,
    outputIngredientId: item.outputIngredientId,
    outputName: item.outputName || item.name,
    outputQty: round(outputQty),
    outputUom: item.yieldUom,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    updatedAt: new Date().toISOString(),
  });
  await replaceScaledLines(id, item.lines, scale);
  return toConversion(header as Record<string, unknown>);
}

export async function deleteConversion(id: string): Promise<void> {
  const prev = await getConversion(id);
  if (!prev) throw new ValidationError("Conversion not found.");
  if (prev.status === "Completed") {
    throw new ConflictError(
      `${prev.conversionNo} is completed — stock already moved. Create a reverse batch if needed.`,
    );
  }
  const lines = await listRows<{ id: string }>(conversionTables.lines, { filters: { conversion_id: id } });
  for (const line of lines) await deleteRow(conversionTables.lines, line.id);
  await deleteRow(conversionTables.conversions, id);
}

/** Deduct input ingredients and increase prepared-item on-hand. */
export async function completeConversion(id: string, completedBy = ""): Promise<Conversion> {
  const prev = await getConversion(id);
  if (!prev) throw new ValidationError("Conversion not found.");
  if (prev.status === "Completed") throw new ConflictError(`${prev.conversionNo} is already completed.`);
  if (prev.status === "Cancelled") throw new ConflictError(`${prev.conversionNo} is cancelled.`);
  if (prev.lines.length === 0) throw new ValidationError("No ingredients to deduct — check the conversion item BOM.");

  const short: string[] = [];
  for (const line of prev.lines) {
    const ing = await getRowById<IngredientRow>(fbTables.ingredients, line.ingredientId);
    if (!ing) throw new ValidationError(`Ingredient ${line.ingredientName || line.ingredientId} was not found.`);
    const onHand = num(ing.onHand);
    if (onHand < line.qty) {
      short.push(`${ing.name}: need ${line.qty} ${line.uom || ing.uom || ""}, have ${onHand}`);
    }
  }
  if (short.length) {
    throw new ValidationError(`Not enough stock to complete ${prev.conversionNo}: ${short.join("; ")}`);
  }

  for (const line of prev.lines) {
    const ing = await getRowById<IngredientRow>(fbTables.ingredients, line.ingredientId);
    if (!ing) continue;
    await updateRow(fbTables.ingredients, ing.id, {
      onHand: round(num(ing.onHand) - line.qty),
    });
  }

  const output = await getRowById<IngredientRow>(fbTables.ingredients, prev.outputIngredientId);
  if (!output) throw new ValidationError("Prepared item was not found in Ingredients.");
  await updateRow(fbTables.ingredients, output.id, {
    onHand: round(num(output.onHand) + prev.outputQty),
    kind: "prepared",
  });

  // Credit kitchen PS stock so recipes / POS can deduct converted items.
  const master = prev.conversionItemId ? await getConversionItem(prev.conversionItemId) : null;
  const psProduct = await ensurePsProductForPrepared({
    name: prev.outputName || output.name,
    uom: prev.outputUom || String(output.uom ?? "Kg"),
    code: master?.code,
    existingPsProductId: master?.psProductId || undefined,
  });
  if (master && master.psProductId !== psProduct.id) {
    await updateRow("fb_conversion_items", master.id, { psProductId: psProduct.id });
  }
  await creditPreparedPsStock({
    psProductId: psProduct.id,
    qty: prev.outputQty,
    conversionNo: prev.conversionNo,
    outputName: prev.outputName || output.name,
  });

  const header = await updateRow<Record<string, unknown>>(conversionTables.conversions, id, {
    status: "Completed",
    completedAt: new Date().toISOString(),
    completedBy: completedBy || "",
    updatedAt: new Date().toISOString(),
  });
  return toConversion(header as Record<string, unknown>);
}

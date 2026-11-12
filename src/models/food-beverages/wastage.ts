import { ValidationError } from "../../errors/index.js";
import { getRowById, updateRow } from "../front-office/base.js";
import { fbTables } from "./index.js";
import { conversionItemTables } from "./conversion-items.js";

export type WastageItemCategory = "ingredient" | "converted" | "other";

type IngredientRow = {
  id: string;
  name: string;
  code?: string;
  uom?: string;
  onHand?: number;
  kind?: string;
  status?: string;
};

type ConversionItemRow = {
  id: string;
  name: string;
  code?: string;
  yieldUom?: string;
  outputIngredientId?: string;
  status?: string;
};

function round(n: number, places = 4) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function text(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeCategory(raw: unknown): WastageItemCategory {
  const v = text(raw).toLowerCase();
  if (v === "ingredient" || v === "converted" || v === "other") return v;
  return "other";
}

/** Resolve display name / uom and validate the linked master for wastage. */
export async function resolveWastageItem(body: Record<string, unknown>) {
  const itemCategory = normalizeCategory(body.itemCategory ?? body.item_category);
  const itemId = text(body.itemId ?? body.item_id) || null;
  let item = text(body.item);
  let uom = text(body.uom);
  let ingredientIdForStock: string | null = null;

  if (itemCategory === "other") {
    if (!item) throw new ValidationError("Enter the item name for other wastage.");
    return {
      itemCategory,
      itemId: null,
      item,
      uom,
      ingredientIdForStock: null,
    };
  }

  if (!itemId) {
    throw new ValidationError(
      itemCategory === "ingredient"
        ? "Select the ingredient being wasted."
        : "Select the converted / prepared item being wasted.",
    );
  }

  if (itemCategory === "ingredient") {
    const ing = await getRowById<IngredientRow>(fbTables.ingredients, itemId);
    if (!ing) throw new ValidationError("Selected ingredient was not found.");
    if (String(ing.kind ?? "raw").toLowerCase() === "prepared") {
      throw new ValidationError("Use Converted item for prepared / transformed stock.");
    }
    item = ing.name;
    uom = uom || text(ing.uom) || "";
    ingredientIdForStock = ing.id;
  } else {
    const conv = await getRowById<ConversionItemRow>(conversionItemTables.items, itemId);
    if (!conv) throw new ValidationError("Selected converted item was not found.");
    item = conv.name;
    uom = uom || text(conv.yieldUom) || "";
    ingredientIdForStock = text(conv.outputIngredientId) || null;
    if (!ingredientIdForStock) {
      throw new ValidationError(`${conv.name} has no stock link — recreate the conversion item.`);
    }
  }

  return { itemCategory, itemId, item, uom, ingredientIdForStock };
}

/** Deduct on-hand from the linked F&B ingredient / prepared stock row. */
export async function deductWastageStock(opts: {
  ingredientId: string;
  qty: number;
  label: string;
}) {
  const qty = num(opts.qty);
  if (!(qty > 0)) throw new ValidationError("Quantity must be greater than 0.");

  const ing = await getRowById<IngredientRow>(fbTables.ingredients, opts.ingredientId);
  if (!ing) throw new ValidationError(`${opts.label} stock row was not found.`);

  const have = num(ing.onHand);
  if (have < qty) {
    throw new ValidationError(
      `Not enough ${ing.name} on hand to write off ${qty}${ing.uom ? ` ${ing.uom}` : ""} (have ${have}).`,
    );
  }

  await updateRow(fbTables.ingredients, ing.id, {
    onHand: round(Math.max(0, have - qty)),
  });
}

/** Normalize + optionally deduct stock before insert / update. */
export async function prepareWastageBody(
  body: Record<string, unknown>,
  opts: { isCreate: boolean; existing?: Record<string, unknown> | null },
) {
  const resolved = await resolveWastageItem(body);
  const qty = num(body.qty);
  if (!(qty > 0)) throw new ValidationError("Quantity must be greater than 0.");

  // Logging wastage always posts as Approved and deducts linked stock once.
  const status = "Approved";
  const alreadyDeducted = Boolean(opts.existing?.stockDeducted ?? opts.existing?.stock_deducted);
  const shouldDeduct = !alreadyDeducted && Boolean(resolved.ingredientIdForStock);

  if (shouldDeduct && resolved.ingredientIdForStock) {
    await deductWastageStock({
      ingredientId: resolved.ingredientIdForStock,
      qty,
      label: resolved.item,
    });
  }

  const next: Record<string, unknown> = {
    ...body,
    itemCategory: resolved.itemCategory,
    itemId: resolved.itemId,
    item: resolved.item,
    uom: resolved.uom,
    qty,
    status,
  };

  if (shouldDeduct) {
    next.stockDeducted = true;
    next.stockDeductedAt = new Date().toISOString();
  } else if (opts.isCreate) {
    next.stockDeducted = false;
    next.stockDeductedAt = null;
  }

  return next;
}

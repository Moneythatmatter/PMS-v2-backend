import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { AppError, ValidationError } from "../../errors/index.js";
import { insertRow, listRows, updateRow } from "../../models/front-office/base.js";
import { psTables } from "../../models/purchase-stores/index.js";
import { fbModel } from "../../models/food-beverages/index.js";
import {
  getRecipe,
  listActiveRecipesForMenuItems,
  recipeTables,
  type Recipe,
} from "../../models/food-beverages/recipes.js";

type SourceType = "POS Sale" | "Manual";

export type ConsumptionLine = {
  materialId: string;
  productCode: string;
  materialName: string;
  stockUnit: string;
  quantity: number;
  unitCost: number;
  value: number;
  balanceAfter: number;
};

export type RecipeConsumption = {
  id: string;
  consumptionNo: string;
  recipeId: string;
  sourceType: SourceType;
  sourceRef: string;
  menuItemId: string | null;
  portions: number;
  warehouseId: string;
  totalCost: number;
  lines: ConsumptionLine[];
  remarks: string;
  consumedBy: string;
  consumedAt: string;
};

type BalanceRow = { id: string; materialId: string; quantity: number; averageCost: number };

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function defaultKitchenStore(): Promise<string | null> {
  const stores = await listRows<{ id: string; name: string; status: string }>(psTables.warehouses, { orderBy: "code" });
  const active = stores.filter((w) => w.status !== "Inactive");
  return (active.find((w) => /kitchen/i.test(w.name)) ?? active[0])?.id ?? null;
}

async function balancesIn(warehouseId: string, materialIds: string[]) {
  if (materialIds.length === 0) return new Map<string, BalanceRow>();
  const { data, error } = await supabase
    .from(psTables.stockBalances)
    .select("id, material_id, quantity, average_cost")
    .eq("warehouse_id", warehouseId)
    .in("material_id", materialIds);
  if (error) throw new Error(error.message);
  return new Map(toCamel<BalanceRow[]>(data ?? []).map((b) => [b.materialId, b]));
}

function nextConsumptionNo() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `CON-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** Stock each ingredient needs for `portions`, in the material's stock unit. */
export function consumptionPlan(recipe: Recipe, portions: number) {
  const factor = portions / (recipe.yieldQuantity || 1);
  return recipe.ingredients
    .map((i) => ({ ingredient: i, quantity: round(i.grossStockQuantity * factor) }))
    .filter((p) => p.quantity > 0);
}

/**
 * Deduct a recipe's ingredients from one store and post them to the stock ledger.
 * POS sales are idempotent per (order, recipe) and may drive stock negative, because the food is already sold;
 * manual entries are refused when the store is short.
 */
export async function consumeRecipe(input: {
  recipe: Recipe;
  portions: number;
  sourceType: SourceType;
  sourceRef?: string;
  warehouseId?: string | null;
  menuItemId?: string | null;
  remarks?: string;
  consumedBy?: string;
}): Promise<RecipeConsumption | null> {
  const { recipe, sourceType } = input;
  const portions = Number(input.portions);
  if (!(portions > 0)) throw new ValidationError("Portions must be greater than 0.");
  if (recipe.ingredients.length === 0) throw new ValidationError(`${recipe.name} has no ingredients.`);

  const warehouseId = input.warehouseId || recipe.issueWarehouseId || (await defaultKitchenStore());
  if (!warehouseId) throw new ValidationError("Choose the store to issue ingredients from.");

  const plan = consumptionPlan(recipe, portions);
  const balances = await balancesIn(warehouseId, plan.map((p) => p.ingredient.materialId));

  if (sourceType === "Manual") {
    const short = plan.filter((p) => (Number(balances.get(p.ingredient.materialId)?.quantity) || 0) < p.quantity);
    if (short.length > 0) {
      throw new ValidationError(
        `Not enough stock in the selected store: ${short
          .map((p) => {
            const have = Number(balances.get(p.ingredient.materialId)?.quantity) || 0;
            return `${p.ingredient.materialName} needs ${p.quantity} ${p.ingredient.stockUnit}, has ${round(have)}`;
          })
          .join("; ")}`,
      );
    }
  }

  const consumptionNo = nextConsumptionNo();
  const { data: header, error: headerError } = await supabase
    .from(recipeTables.consumptions)
    .insert({
      consumption_no: consumptionNo,
      recipe_id: recipe.id,
      source_type: sourceType,
      source_ref: input.sourceRef ?? "",
      menu_item_id: input.menuItemId ?? recipe.menuItemId,
      portions,
      warehouse_id: warehouseId,
      remarks: input.remarks ?? "",
      consumed_by: input.consumedBy ?? "",
    })
    .select()
    .single();
  if (headerError) {
    if (headerError.code === "23505" && sourceType === "POS Sale") return null;
    throwIfRlsError(headerError.message);
  }

  const now = new Date().toISOString();
  const lines: ConsumptionLine[] = [];
  for (const { ingredient, quantity } of plan) {
    const balance = balances.get(ingredient.materialId);
    const before = Number(balance?.quantity) || 0;
    const after = round(before - quantity);
    const unitCost = Number(balance?.averageCost) || ingredient.unitCost;

    if (balance) {
      await updateRow(psTables.stockBalances, balance.id, { quantity: after, lastMovementAt: now });
    } else {
      await insertRow(psTables.stockBalances, {
        materialId: ingredient.materialId,
        warehouseId,
        quantity: after,
        averageCost: unitCost,
        lastMovementAt: now,
        status: "Active",
      });
    }

    const shortBy = before < quantity ? ` — short by ${round(quantity - Math.max(before, 0))} ${ingredient.stockUnit}` : "";
    await insertRow(psTables.stockLedger, {
      transactionDate: now.slice(0, 10),
      transactionNo: consumptionNo,
      movementType: "Recipe Consumption",
      materialId: ingredient.materialId,
      warehouseId,
      quantityIn: 0,
      quantityOut: quantity,
      balanceQty: after,
      remarks: `${recipe.name} × ${portions} (${sourceType}${input.sourceRef ? ` ${input.sourceRef}` : ""})${shortBy}`,
    });

    lines.push({
      materialId: ingredient.materialId,
      productCode: ingredient.productCode,
      materialName: ingredient.materialName,
      stockUnit: ingredient.stockUnit,
      quantity,
      unitCost: round(unitCost, 4),
      value: round(quantity * unitCost, 2),
      balanceAfter: after,
    });
  }

  const totalCost = round(lines.reduce((s, l) => s + l.value, 0), 2);
  const saved = await updateRow<Record<string, unknown>>(recipeTables.consumptions, String(header.id), {
    totalCost,
    lines,
  });
  return toConsumption(saved);
}

function toConsumption(row: Record<string, unknown>): RecipeConsumption {
  return {
    ...(row as unknown as RecipeConsumption),
    portions: Number(row.portions) || 0,
    totalCost: Number(row.totalCost) || 0,
    lines: (row.lines as ConsumptionLine[]) ?? [],
  };
}

export async function consumeRecipeById(
  recipeId: string,
  input: { portions: number; warehouseId?: string; remarks?: string; reference?: string; consumedBy?: string },
) {
  const recipe = await getRecipe(recipeId);
  if (!recipe) throw new AppError("Recipe not found", 404);
  if (!recipe.isActive) throw new ValidationError(`${recipe.name} is inactive. Activate it before recording consumption.`);
  return consumeRecipe({
    recipe,
    portions: input.portions,
    sourceType: "Manual",
    sourceRef: input.reference,
    warehouseId: input.warehouseId,
    remarks: input.remarks,
    consumedBy: input.consumedBy,
  });
}

/** Deduct ingredients for every recipe-linked item on a settled order. Safe to call more than once. */
export async function consumeRecipesForOrder(orderId: string) {
  const items = await fbModel.list<{ menuItemId: string | null; quantity: number; status: string }>(
    fbModel.tables.orderItems,
    { filters: { order_id: orderId } },
  );
  const qtyByMenuItem = new Map<string, number>();
  for (const item of items) {
    if (String(item.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    const menuItemId = String(item.menuItemId ?? "");
    if (!UUID.test(menuItemId)) continue;
    qtyByMenuItem.set(menuItemId, (qtyByMenuItem.get(menuItemId) ?? 0) + (Number(item.quantity) || 0));
  }
  if (qtyByMenuItem.size === 0) return [];

  const recipes = await listActiveRecipesForMenuItems([...qtyByMenuItem.keys()]);
  const posted: RecipeConsumption[] = [];
  for (const recipe of recipes) {
    const portions = qtyByMenuItem.get(String(recipe.menuItemId)) ?? 0;
    if (portions <= 0 || recipe.ingredients.length === 0) continue;
    try {
      const row = await consumeRecipe({
        recipe,
        portions,
        sourceType: "POS Sale",
        sourceRef: orderId,
        consumedBy: "POS",
      });
      if (row) posted.push(row);
    } catch (e) {
      console.warn(`[F&B] recipe consumption failed for ${recipe.name} on order ${orderId}:`, e);
    }
  }
  return posted;
}

export async function listConsumptions(filters: { recipeId?: string; limit?: number } = {}) {
  let query = supabase
    .from(recipeTables.consumptions)
    .select("*")
    .order("consumed_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.recipeId) query = query.eq("recipe_id", filters.recipeId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return toCamel<Record<string, unknown>[]>(data ?? []).map(toConsumption);
}

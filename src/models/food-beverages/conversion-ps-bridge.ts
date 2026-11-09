import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import {
  getRowById,
  insertRow,
  listRows,
  newId,
  updateRow,
} from "../front-office/base.js";
import { psTables } from "../purchase-stores/index.js";
import { fbTables } from "./index.js";
import { conversionItemTables } from "./conversion-items.js";

type PsProduct = {
  id: string;
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  status?: string;
};

type BalanceRow = {
  id: string;
  materialId: string;
  warehouseId: string;
  quantity: number;
  averageCost: number;
};

const PREPARED_CATEGORY = "Prepared Item";

function round(n: number, places = 4) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export async function defaultKitchenStoreId(): Promise<string | null> {
  const stores = await listRows<{ id: string; name: string; status: string }>(psTables.warehouses, {
    orderBy: "code",
  });
  const active = stores.filter((w) => w.status !== "Inactive");
  return (active.find((w) => /kitchen/i.test(w.name)) ?? active[0])?.id ?? null;
}

/** Ensure a PS product exists for a conversion prepared item (recipes + POS stock). */
export async function ensurePsProductForPrepared(opts: {
  name: string;
  uom: string;
  code?: string;
  existingPsProductId?: string;
}): Promise<PsProduct> {
  const name = opts.name.trim();
  const uom = (opts.uom || "Kg").trim() || "Kg";

  if (opts.existingPsProductId) {
    const byId = await getRowById<PsProduct>(psTables.products, opts.existingPsProductId);
    if (byId) {
      const updates: Record<string, unknown> = {};
      if (byId.productName !== name) updates.productName = name;
      if (byId.unit !== uom) updates.unit = uom;
      if (byId.category !== PREPARED_CATEGORY) updates.category = PREPARED_CATEGORY;
      if (String(byId.status ?? "Active") === "Inactive") updates.status = "Active";
      if (Object.keys(updates).length) {
        updates.updatedDate = new Date().toISOString().slice(0, 10);
        return (await updateRow<PsProduct>(psTables.products, byId.id, updates)) as PsProduct;
      }
      return byId;
    }
  }

  const all = await listRows<PsProduct>(psTables.products, {});
  const needle = name.toLowerCase();
  const match =
    all.find(
      (p) =>
        String(p.productName ?? "").trim().toLowerCase() === needle &&
        String(p.category ?? "") === PREPARED_CATEGORY,
    ) || all.find((p) => String(p.productName ?? "").trim().toLowerCase() === needle);

  if (match) {
    const updates: Record<string, unknown> = {};
    if (match.unit !== uom) updates.unit = uom;
    if (match.category !== PREPARED_CATEGORY) updates.category = PREPARED_CATEGORY;
    if (String(match.status ?? "Active") === "Inactive") updates.status = "Active";
    if (Object.keys(updates).length) {
      updates.updatedDate = new Date().toISOString().slice(0, 10);
      return (await updateRow<PsProduct>(psTables.products, match.id, updates)) as PsProduct;
    }
    return match;
  }

  const code = (opts.code || "").trim() || `PREP-${Date.now().toString(36).toUpperCase()}`;
  return insertRow<PsProduct>(psTables.products, {
    id: newId(),
    productCode: code,
    productName: name,
    category: PREPARED_CATEGORY,
    unit: uom,
    brand: "",
    description: "Kitchen prepared item from F&B Conversion",
    minimumStock: 0,
    maximumStock: 0,
    parStock: 0,
    reorderLevel: 0,
    storageType: "Cold Room",
    status: "Active",
    createdDate: new Date().toISOString().slice(0, 10),
  });
}

/** Credit kitchen store stock when a conversion batch is completed. */
export async function creditPreparedPsStock(opts: {
  psProductId: string;
  qty: number;
  unitCost?: number;
  conversionNo: string;
  outputName: string;
}) {
  if (!(opts.qty > 0) || !opts.psProductId) return;
  const warehouseId = await defaultKitchenStoreId();
  if (!warehouseId) return;

  const { data, error } = await supabase
    .from(psTables.stockBalances)
    .select("id, material_id, warehouse_id, quantity, average_cost")
    .eq("warehouse_id", warehouseId)
    .eq("material_id", opts.psProductId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const balance = data ? toCamel<BalanceRow>(data) : null;
  const now = new Date().toISOString();
  const unitCost = Number(opts.unitCost) || 0;
  let after = round(opts.qty);

  if (balance?.id) {
    const before = Number(balance.quantity) || 0;
    const prevCost = Number(balance.averageCost) || 0;
    after = round(before + opts.qty);
    const avg =
      after > 0 ? round((before * prevCost + opts.qty * unitCost) / after, 4) : unitCost;
    await updateRow(psTables.stockBalances, String(balance.id), {
      quantity: after,
      averageCost: avg,
      lastMovementAt: now,
    });
  } else {
    await insertRow(psTables.stockBalances, {
      materialId: opts.psProductId,
      warehouseId,
      quantity: after,
      averageCost: unitCost,
      lastMovementAt: now,
      status: "Active",
    });
  }

  await insertRow(psTables.stockLedger, {
    transactionDate: now.slice(0, 10),
    transactionNo: opts.conversionNo,
    movementType: "Conversion Production",
    materialId: opts.psProductId,
    warehouseId,
    quantityIn: opts.qty,
    quantityOut: 0,
    balanceQty: after,
    remarks: `Conversion produced ${opts.qty} of ${opts.outputName}`,
  });
}

/** When a recipe consumes PS materials, also reduce matching F&B ingredient / prepared on-hand. */
export async function deductFbPreparedForPsMaterials(
  lines: Array<{ materialId: string; quantity: number; materialName?: string; productCode?: string }>,
) {
  if (lines.length === 0) return;
  const items = await listRows<{
    id: string;
    psProductId?: string;
    outputIngredientId?: string;
  }>(conversionItemTables.items, {});

  const byPs = new Map(
    items
      .filter((i) => i.psProductId)
      .map((i) => [String(i.psProductId), String(i.outputIngredientId ?? "")]),
  );

  const ingredients = await listRows<{
    id: string;
    code?: string;
    name: string;
    onHand?: number;
    kind?: string;
  }>(fbTables.ingredients, {});
  const byCode = new Map(
    ingredients
      .filter((i) => String(i.code ?? "").trim())
      .map((i) => [String(i.code).trim().toLowerCase(), i.id]),
  );
  const byName = new Map(
    ingredients.map((i) => [String(i.name ?? "").trim().toLowerCase(), i.id]),
  );

  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const codeKey = String(line.productCode ?? "").trim().toLowerCase();
    const nameKey = String(line.materialName ?? "").trim().toLowerCase();
    const fbId =
      byPs.get(line.materialId) ||
      (codeKey ? byCode.get(codeKey) : undefined) ||
      (nameKey ? byName.get(nameKey) : undefined);
    if (!fbId) {
      console.warn(
        `[F&B] no Ingredients row matched for stock sync (${line.productCode || "?"} ${line.materialName || line.materialId})`,
      );
      continue;
    }
    const ing = await getRowById<{ id: string; onHand?: number; uom?: string }>(fbTables.ingredients, fbId);
    if (!ing) continue;
    await updateRow(fbTables.ingredients, ing.id, {
      onHand: round(Math.max(0, (Number(ing.onHand) || 0) - line.quantity)),
    });
  }
}

export { PREPARED_CATEGORY };

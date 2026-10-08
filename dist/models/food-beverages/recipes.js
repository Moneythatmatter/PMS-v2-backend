import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { unitConversionFactor } from "../../utils/units.js";
import { ConflictError, ValidationError } from "../../errors/index.js";
import { deleteRow, getRowById, insertRow, listRows, updateRow } from "../front-office/base.js";
import { psTables } from "../purchase-stores/index.js";
import { fbTables } from "./index.js";
export const recipeTables = {
    recipes: "fb_recipes",
    ingredients: "fb_recipe_ingredients",
    consumptions: "fb_recipe_consumptions",
};
const HEADER = recipeTables.recipes;
const ITEMS = recipeTables.ingredients;
const IN_CHUNK = 150;
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};
const text = (v) => String(v ?? "").trim();
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
function chunks(list, size = IN_CHUNK) {
    const out = [];
    for (let i = 0; i < list.length; i += size)
        out.push(list.slice(i, i + size));
    return out;
}
async function selectIn(table, column, values, columns = "*") {
    const unique = [...new Set(values.filter(Boolean))];
    const out = [];
    for (const batch of chunks(unique)) {
        const { data, error } = await supabase.from(table).select(columns).in(column, batch);
        if (error)
            throw new Error(error.message);
        out.push(...toCamel(data ?? []));
    }
    return out;
}
export async function loadProducts(ids) {
    const rows = await selectIn(psTables.products, "id", ids, "id, product_code, product_name, category, unit, status");
    return new Map(rows.map((p) => [p.id, p]));
}
export async function loadBalances(materialIds) {
    return selectIn(psTables.stockBalances, "material_id", materialIds, "material_id, warehouse_id, quantity, average_cost");
}
/** Weighted average cost per stock unit across stores; falls back to the last known rate when nothing is on hand. */
function averageCostByMaterial(balances) {
    const acc = new Map();
    for (const b of balances) {
        const entry = acc.get(b.materialId) ?? { qty: 0, value: 0, lastRate: 0 };
        const qty = num(b.quantity);
        const rate = num(b.averageCost);
        if (qty > 0) {
            entry.qty += qty;
            entry.value += qty * rate;
        }
        entry.lastRate = Math.max(entry.lastRate, rate);
        acc.set(b.materialId, entry);
    }
    const out = new Map();
    for (const [id, e] of acc)
        out.set(id, e.qty > 0 ? e.value / e.qty : e.lastRate);
    return out;
}
export function grossStockQuantity(stockQuantity, ingredientWastage, recipeWastage) {
    return stockQuantity * (1 + ingredientWastage / 100) * (1 + recipeWastage / 100);
}
async function fetchItemRows(recipeIds) {
    if (recipeIds && recipeIds.length === 0)
        return [];
    if (!recipeIds) {
        const { data, error } = await supabase
            .from(ITEMS)
            .select("*")
            .order("recipe_id", { ascending: true })
            .order("line_no", { ascending: true })
            .range(0, 9999);
        if (error)
            throw new Error(error.message);
        return toCamel(data ?? []);
    }
    const rows = await selectIn(ITEMS, "recipe_id", recipeIds);
    return rows.sort((a, b) => a.lineNo - b.lineNo);
}
async function loadLookups() {
    const [categories, menuItems, warehouses] = await Promise.all([
        listRows(fbTables.menuCategories),
        listRows(fbTables.menuItems),
        listRows(psTables.warehouses),
    ]);
    return {
        categories: new Map(categories.map((c) => [c.id, c])),
        menuItems: new Map(menuItems.map((m) => [m.id, m])),
        warehouses: new Map(warehouses.map((w) => [w.id, w])),
    };
}
/** Join ingredients to the material master and current stock, and compute batch / portion cost. */
async function hydrate(headers, all = false) {
    const items = await fetchItemRows(all ? undefined : headers.map((h) => h.id));
    const materialIds = items.map((i) => i.materialId);
    const [products, balances, lookups] = await Promise.all([
        loadProducts(materialIds),
        loadBalances(materialIds),
        loadLookups(),
    ]);
    const avgCost = averageCostByMaterial(balances);
    const onHand = new Map();
    for (const b of balances) {
        onHand.set(b.materialId, (onHand.get(b.materialId) ?? 0) + num(b.quantity));
        const key = `${b.materialId}|${b.warehouseId}`;
        onHand.set(key, (onHand.get(key) ?? 0) + num(b.quantity));
    }
    const byRecipe = new Map();
    for (const item of items) {
        const list = byRecipe.get(item.recipeId) ?? [];
        list.push(item);
        byRecipe.set(item.recipeId, list);
    }
    return headers.map((h) => {
        const recipeWastage = num(h.wastagePercent);
        const ingredients = (byRecipe.get(h.id) ?? []).map((row) => {
            const product = products.get(row.materialId);
            const stockQuantity = num(row.quantity) * num(row.conversionFactor, 1);
            const gross = grossStockQuantity(stockQuantity, num(row.wastagePercent), recipeWastage);
            const unitCost = avgCost.get(row.materialId) ?? 0;
            return {
                id: row.id,
                lineNo: row.lineNo,
                materialId: row.materialId,
                productCode: product?.productCode ?? "",
                materialName: product?.productName ?? "Unknown material",
                category: product?.category ?? "",
                quantity: num(row.quantity),
                unit: row.unit,
                stockUnit: product?.unit ?? row.stockUnit,
                conversionFactor: num(row.conversionFactor, 1),
                stockQuantity: round(stockQuantity, 6),
                wastagePercent: num(row.wastagePercent),
                grossStockQuantity: round(gross, 6),
                unitCost: round(unitCost, 4),
                lineCost: round(gross * unitCost),
                onHandIssueStore: h.issueWarehouseId ? (onHand.get(`${row.materialId}|${h.issueWarehouseId}`) ?? 0) : null,
                onHandTotal: onHand.get(row.materialId) ?? 0,
                remarks: row.remarks ?? "",
            };
        });
        const batchCost = ingredients.reduce((s, i) => s + i.lineCost, 0);
        const yieldQuantity = num(h.yieldQuantity, 1) || 1;
        const costPerPortion = batchCost / yieldQuantity;
        const sellingPrice = num(h.sellingPrice);
        const menuItem = h.menuItemId ? lookups.menuItems.get(h.menuItemId) : undefined;
        return {
            id: h.id,
            recipeCode: h.recipeCode,
            name: h.name,
            categoryId: h.categoryId,
            categoryName: h.categoryId ? (lookups.categories.get(h.categoryId)?.name ?? "") : "",
            menuItemId: h.menuItemId,
            menuItemName: menuItem?.name ?? "",
            menuItemPrice: menuItem ? num(menuItem.price) : null,
            yieldQuantity,
            yieldUnit: h.yieldUnit,
            sellingPrice,
            wastagePercent: recipeWastage,
            prepTimeMinutes: h.prepTimeMinutes ?? null,
            issueWarehouseId: h.issueWarehouseId,
            issueWarehouseName: h.issueWarehouseId ? (lookups.warehouses.get(h.issueWarehouseId)?.name ?? "") : "",
            instructions: h.instructions ?? "",
            notes: h.notes ?? "",
            isActive: h.isActive !== false,
            status: h.isActive === false ? "Inactive" : "Active",
            batchCost: round(batchCost),
            costPerPortion: round(costPerPortion),
            foodCostPercent: sellingPrice > 0 ? round((costPerPortion / sellingPrice) * 100) : 0,
            ingredients,
            createdAt: h.createdAt,
            updatedAt: h.updatedAt,
        };
    });
}
export async function listRecipes(filters = {}) {
    let query = supabase.from(HEADER).select("*").order("name", { ascending: true });
    if (filters.active !== undefined)
        query = query.eq("is_active", filters.active);
    if (filters.categoryId)
        query = query.eq("category_id", filters.categoryId);
    const { data, error } = await query;
    if (error)
        throw new Error(error.message);
    const filtered = filters.active !== undefined || Boolean(filters.categoryId);
    return hydrate(toCamel(data ?? []), !filtered);
}
export async function getRecipe(id) {
    const header = await getRowById(HEADER, id);
    if (!header)
        return null;
    const [recipe] = await hydrate([header]);
    return recipe;
}
export async function listActiveRecipesForMenuItems(menuItemIds) {
    const headers = (await selectIn(HEADER, "menu_item_id", menuItemIds)).filter((h) => h.isActive !== false);
    return headers.length ? hydrate(headers) : [];
}
async function nextRecipeCode() {
    const { data, error } = await supabase.from(HEADER).select("recipe_code").like("recipe_code", "RCP-%");
    if (error)
        throw new Error(error.message);
    const max = (data ?? []).reduce((m, r) => {
        const n = Number(String(r.recipe_code).slice(4));
        return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return `RCP-${String(max + 1).padStart(4, "0")}`;
}
async function existingItemRows(recipeId) {
    const { data, error } = await supabase.from(ITEMS).select("*").eq("recipe_id", recipeId);
    if (error)
        throw new Error(error.message);
    return (data ?? []);
}
/** Validate lines against the material master and build child rows. */
async function buildIngredientRows(recipeId, raw, existing) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ValidationError("Add at least one ingredient to the recipe.", [
            { path: "ingredients", message: "At least one ingredient is required" },
        ]);
    }
    const inputs = raw;
    const products = await loadProducts(inputs.map((i) => text(i.materialId)));
    const details = [];
    const seen = new Set();
    const rows = inputs.map((input, idx) => {
        const materialId = text(input.materialId);
        const product = products.get(materialId);
        const label = product?.productName ?? `Ingredient ${idx + 1}`;
        const path = `ingredients[${idx}]`;
        const keepId = input.id && existing.has(String(input.id)) ? String(input.id) : crypto.randomUUID();
        if (!materialId)
            details.push({ path: `${path}.materialId`, message: `${label}: select a material from the Purchase & Stores master` });
        else if (!product)
            details.push({ path: `${path}.materialId`, message: `${label} is not in the material master` });
        else if (product.status === "Inactive" && !existing.has(keepId)) {
            details.push({ path: `${path}.materialId`, message: `${label} is inactive in the material master` });
        }
        if (materialId && seen.has(materialId))
            details.push({ path, message: `${label} is listed more than once` });
        seen.add(materialId);
        const quantity = num(input.quantity);
        if (quantity <= 0)
            details.push({ path: `${path}.quantity`, message: `${label}: quantity must be greater than 0` });
        const unit = text(input.unit) || product?.unit || "";
        const factor = product ? unitConversionFactor(unit, product.unit) : 1;
        if (product && factor === null) {
            details.push({ path: `${path}.unit`, message: `${label}: "${unit}" can't be converted to its stock unit "${product.unit}"` });
        }
        const wastage = num(input.wastagePercent);
        if (wastage < 0 || wastage > 100)
            details.push({ path: `${path}.wastagePercent`, message: `${label}: wastage must be 0–100%` });
        return {
            id: keepId,
            recipe_id: recipeId,
            line_no: idx + 1,
            material_id: materialId,
            quantity,
            unit,
            stock_unit: product?.unit ?? unit,
            conversion_factor: factor ?? 1,
            wastage_percent: wastage,
            remarks: text(input.remarks),
        };
    });
    if (details.length > 0)
        throw new ValidationError(details.map((d) => d.message).join("; "), details);
    return rows;
}
/** Replace the line set wholesale so swapping materials between lines can't trip unique(recipe_id, material_id). */
async function writeIngredientRows(recipeId, rows, previous) {
    if (previous.length > 0) {
        const { error } = await supabase.from(ITEMS).delete().eq("recipe_id", recipeId);
        if (error)
            throw new Error(error.message);
    }
    const { error } = await supabase.from(ITEMS).insert(rows);
    if (!error)
        return;
    if (previous.length > 0) {
        const restore = previous.map(({ stock_quantity: _generated, ...row }) => row);
        await supabase.from(ITEMS).insert(restore);
    }
    throwIfRlsError(error.message);
}
/** Validate header fields; returns a camelCase patch with only the fields present in `body`. */
async function buildHeader(body, recipeId, isCreate) {
    const header = {};
    const details = [];
    const has = (k) => body[k] !== undefined;
    if (isCreate || has("name")) {
        const name = text(body.name);
        if (!name)
            details.push({ path: "name", message: "Recipe name is required" });
        header.name = name;
    }
    if (isCreate || has("yieldQuantity")) {
        const yieldQuantity = num(body.yieldQuantity, 1);
        if (!(yieldQuantity > 0))
            details.push({ path: "yieldQuantity", message: "Yield must be greater than 0" });
        header.yieldQuantity = yieldQuantity;
    }
    if (isCreate || has("yieldUnit"))
        header.yieldUnit = text(body.yieldUnit) || "Portions";
    if (isCreate || has("sellingPrice")) {
        const price = num(body.sellingPrice);
        if (price < 0)
            details.push({ path: "sellingPrice", message: "Selling price cannot be negative" });
        header.sellingPrice = price;
    }
    if (isCreate || has("wastagePercent")) {
        const wastage = num(body.wastagePercent);
        if (wastage < 0 || wastage > 100)
            details.push({ path: "wastagePercent", message: "Wastage must be 0–100%" });
        header.wastagePercent = wastage;
    }
    if (has("prepTimeMinutes")) {
        const raw = body.prepTimeMinutes;
        header.prepTimeMinutes = raw === null || raw === "" ? null : Math.max(0, Math.round(num(raw)));
    }
    for (const key of ["instructions", "notes"]) {
        if (isCreate || has(key))
            header[key] = text(body[key]);
    }
    for (const key of ["categoryId", "issueWarehouseId"]) {
        if (has(key))
            header[key] = text(body[key]) || null;
    }
    if (has("isActive") || has("status")) {
        const raw = body.isActive ?? body.status;
        header.isActive = !(raw === false || raw === "false" || raw === "Inactive");
    }
    if (has("menuItemId")) {
        const menuItemId = text(body.menuItemId) || null;
        header.menuItemId = menuItemId;
        if (menuItemId) {
            const item = await getRowById(fbTables.menuItems, menuItemId);
            if (!item) {
                details.push({ path: "menuItemId", message: "Linked menu item no longer exists" });
            }
            else {
                const { data, error } = await supabase.from(HEADER).select("id, name").eq("menu_item_id", menuItemId);
                if (error)
                    throw new Error(error.message);
                const clash = (data ?? []).find((r) => r.id !== recipeId);
                if (clash)
                    throw new ConflictError(`${item.name} already has a recipe (${clash.name}).`);
                if (!header.categoryId && item.categoryId)
                    header.categoryId = item.categoryId;
            }
        }
    }
    if (details.length > 0)
        throw new ValidationError(details.map((d) => d.message).join("; "), details);
    return header;
}
async function snapshotCost(id) {
    const recipe = await getRecipe(id);
    if (!recipe)
        return null;
    await updateRow(HEADER, id, {
        batchCost: recipe.batchCost,
        costPerPortion: recipe.costPerPortion,
        foodCostPercent: recipe.foodCostPercent,
    });
    return recipe;
}
export async function createRecipe(body) {
    const id = crypto.randomUUID();
    const header = await buildHeader(body, null, true);
    const rows = await buildIngredientRows(id, body.ingredients, new Set());
    await insertRow(HEADER, { ...header, id, recipeCode: await nextRecipeCode() });
    try {
        await writeIngredientRows(id, rows, []);
    }
    catch (e) {
        await deleteRow(HEADER, id);
        throw e;
    }
    return (await snapshotCost(id));
}
export async function updateRecipe(id, body) {
    const header = await buildHeader(body, id, false);
    if (body.ingredients !== undefined) {
        const previous = await existingItemRows(id);
        const rows = await buildIngredientRows(id, body.ingredients, new Set(previous.map((r) => String(r.id))));
        await writeIngredientRows(id, rows, previous);
    }
    if (Object.keys(header).length > 0)
        await updateRow(HEADER, id, header);
    return (await snapshotCost(id));
}
export async function deleteRecipe(id) {
    const { count, error } = await supabase
        .from(recipeTables.consumptions)
        .select("id", { count: "exact", head: true })
        .eq("recipe_id", id);
    if (error)
        throw new Error(error.message);
    if ((count ?? 0) > 0) {
        throw new ConflictError("This recipe has stock consumption history. Mark it Inactive instead of deleting it.");
    }
    await deleteRow(HEADER, id);
}
//# sourceMappingURL=recipes.js.map
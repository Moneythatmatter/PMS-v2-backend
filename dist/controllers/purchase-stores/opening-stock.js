import { supabase } from "../../utils/supabase.js";
import { getRowById, insertRow } from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import { ValidationError } from "../../errors/index.js";
import { fromError, ok } from "../../utils/response.js";
import { upsertStockBalance } from "./receiving.js";
const T = psModel.tables;
const round = (n, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
/**
 * POST /stock-balances/opening — put stock that already exists on the books, with its rate.
 * Adds to the store balance (weighted-average cost) and writes an "Opening Stock" ledger line per material.
 */
export async function postOpeningStock(req, res) {
    try {
        const body = (req.body ?? {});
        const warehouseId = String(body.warehouseId ?? "").trim();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : new Date().toISOString().slice(0, 10);
        const reference = String(body.reference ?? "").trim();
        const lines = Array.isArray(body.items) ? body.items : [];
        const details = [];
        const warehouse = warehouseId ? await getRowById(T.warehouses, warehouseId) : null;
        if (!warehouse)
            details.push({ path: "warehouseId", message: "Choose the store the stock is in" });
        if (lines.length === 0)
            details.push({ path: "items", message: "Add at least one material" });
        const materialIds = [...new Set(lines.map((l) => String(l.materialId ?? "").trim()).filter(Boolean))];
        const { data: productRows, error } = materialIds.length
            ? await supabase.from(T.products).select("id, product_name, unit").in("id", materialIds)
            : { data: [], error: null };
        if (error)
            throw new Error(error.message);
        const products = new Map((productRows ?? []).map((p) => [String(p.id), { name: String(p.product_name), unit: String(p.unit) }]));
        const seen = new Set();
        const parsed = lines.map((line, idx) => {
            const materialId = String(line.materialId ?? "").trim();
            const product = products.get(materialId);
            const label = product?.name ?? `Line ${idx + 1}`;
            const quantity = round(Number(line.quantity));
            const unitCost = round(Number(line.unitCost), 2);
            if (!product)
                details.push({ path: `items[${idx}].materialId`, message: `${label}: pick a material from the product master` });
            if (seen.has(materialId))
                details.push({ path: `items[${idx}]`, message: `${label} is listed more than once` });
            seen.add(materialId);
            if (!(quantity > 0))
                details.push({ path: `items[${idx}].quantity`, message: `${label}: quantity must be greater than 0` });
            if (!(unitCost >= 0))
                details.push({ path: `items[${idx}].unitCost`, message: `${label}: rate cannot be negative` });
            return { materialId, product, quantity, unitCost, remarks: String(line.remarks ?? "").trim() };
        });
        if (details.length > 0)
            throw new ValidationError(details.map((d) => d.message).join("; "), details);
        const transactionNo = `OPN-${date.slice(2).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const posted = [];
        for (const line of parsed) {
            const balanceQty = await upsertStockBalance(line.materialId, warehouseId, line.quantity, line.unitCost);
            await insertRow(T.stockLedger, {
                transactionDate: date,
                transactionNo,
                movementType: "Opening Stock",
                materialId: line.materialId,
                warehouseId,
                quantityIn: line.quantity,
                quantityOut: 0,
                balanceQty,
                remarks: [`Opening stock @ ₹${line.unitCost}/${line.product?.unit}`, reference, line.remarks].filter(Boolean).join(" — "),
            });
            posted.push({ materialId: line.materialId, quantity: line.quantity, unitCost: line.unitCost, balanceQty });
        }
        return ok(res, {
            transactionNo,
            warehouseId,
            date,
            lines: posted,
            totalValue: round(parsed.reduce((s, l) => s + l.quantity * l.unitCost, 0), 2),
        }, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=opening-stock.js.map
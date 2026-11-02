import { supabase } from "../../utils/supabase.js";
import { fbModel } from "../../models/food-beverages/index.js";

type Row = Record<string, unknown>;

const CHUNK = 200;

async function selectIn(table: string, columns: string, key: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select(columns).in(key, unique.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out;
}

/**
 * Outlet of each F&B payment. A payment's source_id is the bill (POS) or the order (legacy pay).
 * Returns source_id → outlet_id.
 */
export async function outletBySourceId(sourceIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  const result = new Map<string, string>();
  if (!ids.length) return result;
  const bills = await selectIn(fbModel.tables.bills, "id, order_id", "id", ids);
  const orderIdBySource = new Map<string, string>();
  for (const b of bills) orderIdBySource.set(String(b.id), String(b.order_id ?? ""));
  for (const id of ids) if (!orderIdBySource.has(id)) orderIdBySource.set(id, id);
  const orders = await selectIn(fbModel.tables.orders, "id, outlet_id", "id", [...orderIdBySource.values()]);
  const outletByOrder = new Map(orders.map((o) => [String(o.id), String(o.outlet_id ?? "")]));
  for (const [source, orderId] of orderIdBySource) {
    const outlet = outletByOrder.get(orderId);
    if (outlet) result.set(source, outlet);
  }
  return result;
}

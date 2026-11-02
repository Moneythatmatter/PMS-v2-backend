import { supabase } from "../../utils/supabase.js";
import { AppError } from "../../errors/index.js";
import { accTables, list, propertyId, type Row } from "../../models/accounts/repo.js";
import { outletBySourceId } from "../food-beverages/fb-outlet-payments.js";

/** Billing points an outlet rule can be limited to (null = all of them). */
export const OUTLET_RULE_POINTS = ["FB_RESTAURANT_BILL", "FB_ROOM_SERVICE"] as const;

export type OutletRuleResult = {
  divisionId: string | null;
  incomeAccountId: string | null;
  cashAccountId: string | null;
};

export type OutletPosting = {
  name: (outletId: string) => string;
  /** The billing-point rule wins field by field over the outlet-wide rule. */
  rule: (outletId: string | null | undefined, point?: string | null) => OutletRuleResult;
};

const EMPTY: OutletRuleResult = { divisionId: null, incomeAccountId: null, cashAccountId: null };

const isMissingSchema = (e: unknown) => e instanceof AppError && e.code === "SCHEMA_MISSING";

/** F&B outlets of the active property (id, name, type, status). */
export async function listFbOutlets(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("fb_outlets")
    .select("id, name, type, status")
    .eq("property_id", propertyId())
    .order("name");
  if (error) throw new AppError(`Could not read F&B outlets: ${error.message}`, 500);
  return (data ?? []) as Row[];
}

/** Outlet names and posting rules. Works (with no rules) before fb-outlet-posting.sql is run. */
export async function loadOutletPosting(): Promise<OutletPosting> {
  const [outlets, rules] = await Promise.all([
    listFbOutlets().catch(() => [] as Row[]),
    list(accTables.outletPostingRules, { eq: { status: "Active" } }).catch((e) => {
      if (isMissingSchema(e)) return [] as Row[];
      throw e;
    }),
  ]);
  const names = new Map(outlets.map((o) => [String(o.id), String(o.name ?? o.id)]));
  const byKey = new Map(rules.map((r) => [`${r.outletId}|${r.billingPoint ?? "*"}`, r]));

  return {
    name: (outletId) => names.get(outletId) ?? outletId,
    rule: (outletId, point) => {
      if (!outletId) return EMPTY;
      const general = byKey.get(`${outletId}|*`);
      const specific = point ? byKey.get(`${outletId}|${point}`) : undefined;
      const pick = (field: "divisionId" | "incomeAccountId" | "cashAccountId") =>
        (specific?.[field] as string | null | undefined) || (general?.[field] as string | null | undefined) || null;
      return { divisionId: pick("divisionId"), incomeAccountId: pick("incomeAccountId"), cashAccountId: pick("cashAccountId") };
    },
  };
}

/** id → outlet_id as stored on the row. Empty before fb-outlet-posting.sql adds the column. */
export async function storedOutlets(table: "fb_bills" | "transactions", ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.from(table).select("id, outlet_id").in("id", unique.slice(i, i + 200));
    if (error) return out;
    for (const r of (data ?? []) as Row[]) if (r.outlet_id) out.set(String(r.id), String(r.outlet_id));
  }
  return out;
}

/** Outlet of each F&B transaction: stored outlet_id, else worked out from its bill / order. */
export async function fnbTransactionOutlets(rows: { id: string; sourceId: string }[]): Promise<Map<string, string>> {
  const result = await storedOutlets("transactions", rows.map((r) => r.id));
  const missing = rows.filter((r) => !result.has(r.id) && r.sourceId);
  if (missing.length) {
    const bySource = await outletBySourceId(missing.map((r) => r.sourceId));
    for (const r of missing) {
      const outlet = bySource.get(r.sourceId);
      if (outlet) result.set(r.id, outlet);
    }
  }
  return result;
}

import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";

type Row = Record<string, unknown>;

/** Places in the PMS that raise a taxable charge. Add a code here before wiring a new module. */
export const BILLING_POINTS = [
  {
    code: "FO_ROOM_NIGHT",
    module: "Front Office",
    label: "Room charge (Night Audit / checkout)",
    defaultCategoryCode: "ROOM",
  },
  {
    code: "FO_LAUNDRY",
    module: "Front Office",
    label: "Laundry charge on guest folio",
    defaultCategoryCode: null,
  },
  {
    code: "FO_MINIBAR",
    module: "Front Office",
    label: "Mini bar charge on guest folio",
    defaultCategoryCode: null,
  },
  {
    code: "FO_OTHER_CHARGE",
    module: "Front Office",
    label: "Other front-desk charge on guest folio",
    defaultCategoryCode: null,
  },
  {
    code: "FB_RESTAURANT_BILL",
    module: "Food & Beverages",
    label: "Restaurant bill (dine-in / takeaway)",
    defaultCategoryCode: null,
  },
  {
    code: "FB_ROOM_SERVICE",
    module: "Food & Beverages",
    label: "Room service bill",
    defaultCategoryCode: null,
  },
] as const;

export type BillingPointCode = (typeof BILLING_POINTS)[number]["code"];

export const BILLING_POINT_CODES = BILLING_POINTS.map((p) => p.code) as readonly string[];

/** Billing point that prices (and later posts) a guest folio charge. */
export function chargeBillingPoint(chargeCategory: string, sourceType?: string | null): BillingPointCode {
  if (sourceType === "ROOM_NIGHT") return "FO_ROOM_NIGHT";
  if (sourceType === "ROOM_SERVICE" || sourceType === "ROOM_SERVICE_REVERSAL") return "FB_ROOM_SERVICE";
  const category = String(chargeCategory ?? "").toUpperCase();
  if (category === "ROOM" && sourceType !== "MANUAL_CHARGE") return "FO_ROOM_NIGHT";
  switch (category) {
    case "FOOD_BEVERAGE":
      return "FB_RESTAURANT_BILL";
    case "LAUNDRY":
      return "FO_LAUNDRY";
    case "MINIBAR":
      return "FO_MINIBAR";
    default:
      return "FO_OTHER_CHARGE";
  }
}

export const APPLICATIONS_TABLE = "acc_tax_applications";

export type TaxLine = {
  taxCode: string;
  taxName: string;
  taxType: string;
  rate: number;
  calculationType: string;
  amount: number;
  outputAccountId: string;
  ruleCode: string;
};

export type TaxQuote =
  | { ok: true; taxAmount: number; taxableAmount: number; lines: TaxLine[] }
  | { ok: false; issue: string };

export type TaxRuleDef = {
  id?: string;
  taxId: string;
  ruleCode: string;
  ruleName: string;
  minimum: number | null;
  maximum: number | null;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
};

export type TaxDefinitionDef = {
  id: string;
  code: string;
  name: string;
  type: string;
  rate: number;
  calculationType: string;
  outputAccountId: string;
  status: string;
};

/** Rules and taxes for one revenue category, plus setup problems that block every quote. */
export type TaxRuleset = {
  issues: string[];
  rules: TaxRuleDef[];
  taxes: Map<string, TaxDefinitionDef>;
};

type Category = { id: string; code: string; name: string; incomeAccountId: string; status: string };

type Application = {
  billingPoint: string;
  revenueCategoryId: string;
  priceIncludesTax: boolean;
  taxRuleIds: string[];
  divisionId: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
};

export type TaxSetup = {
  categories: Category[];
  rules: (TaxRuleDef & { revenueCategoryId: string })[];
  taxes: Map<string, TaxDefinitionDef>;
  applications: Application[];
};

export type BillingPointResolution =
  | { configured: false }
  | {
      configured: true;
      categoryId: string;
      categoryCode: string;
      categoryName: string;
      incomeAccountId: string;
      divisionId: string;
      priceIncludesTax: boolean;
      source: "mapping" | "default";
      ruleset: TaxRuleset;
    };

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nullableNum(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDay(value: unknown) {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function inr(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function inEffect(from: string, to: string, date: string) {
  return (!from || from <= date) && (!to || to >= date);
}

export function billingPointLabel(code: string) {
  const p = BILLING_POINTS.find((b) => b.code === code);
  return p ? `${p.module} · ${p.label}` : code;
}

export async function loadTaxSetup(): Promise<TaxSetup> {
  const propertyId = getActivePropertyId();
  if (!propertyId) throw new AppError("Select a property first");

  const [catRes, ruleRes, taxRes, appRes] = await Promise.all([
    supabase
      .from("acc_revenue_categories")
      .select("id, revenue_category_code, revenue_category_name, income_account_id, status")
      .eq("property_id", propertyId),
    supabase
      .from("acc_tax_rules")
      .select("id, tax_id, revenue_category_id, tax_rule_code, tax_rule_name, minimum_amount, maximum_amount, priority, effective_from, effective_to, status")
      .eq("property_id", propertyId),
    supabase
      .from("acc_tax_definitions")
      .select("id, tax_code, tax_name, tax_type, rate, calculation_type, output_account_id, status")
      .eq("property_id", propertyId),
    supabase
      .from(APPLICATIONS_TABLE)
      .select("*")
      .eq("property_id", propertyId),
  ]);
  for (const res of [catRes, ruleRes, taxRes]) {
    if (res.error) throw new AppError(`Could not read Accounts tax setup: ${res.error.message}`, 500);
  }
  // Before accounts-tax-billing-points.sql the table is absent; defaults still apply.
  if (appRes.error && !/acc_tax_applications|schema cache|does not exist/i.test(appRes.error.message)) {
    throw new AppError(`Could not read tax billing points: ${appRes.error.message}`, 500);
  }

  const taxes = new Map<string, TaxDefinitionDef>();
  for (const t of (taxRes.data ?? []) as Row[]) {
    taxes.set(String(t.id), {
      id: String(t.id),
      code: String(t.tax_code ?? ""),
      name: String(t.tax_name ?? ""),
      type: String(t.tax_type ?? ""),
      rate: num(t.rate),
      calculationType: String(t.calculation_type ?? "Percentage"),
      outputAccountId: String(t.output_account_id ?? ""),
      status: String(t.status ?? ""),
    });
  }

  return {
    categories: ((catRes.data ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      code: String(c.revenue_category_code ?? ""),
      name: String(c.revenue_category_name ?? ""),
      incomeAccountId: String(c.income_account_id ?? ""),
      status: String(c.status ?? ""),
    })),
    rules: ((ruleRes.data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      revenueCategoryId: String(r.revenue_category_id ?? ""),
      taxId: String(r.tax_id),
      ruleCode: String(r.tax_rule_code ?? ""),
      ruleName: String(r.tax_rule_name ?? ""),
      minimum: nullableNum(r.minimum_amount),
      maximum: nullableNum(r.maximum_amount),
      priority: num(r.priority) || 1,
      effectiveFrom: isoDay(r.effective_from),
      effectiveTo: isoDay(r.effective_to),
      status: String(r.status ?? ""),
    })),
    taxes,
    applications: appRes.error
      ? []
      : ((appRes.data ?? []) as Row[]).map((a) => ({
          billingPoint: String(a.billing_point ?? ""),
          revenueCategoryId: String(a.revenue_category_id ?? ""),
          priceIncludesTax: a.price_includes_tax === true,
          taxRuleIds: Array.isArray(a.tax_rule_ids) ? (a.tax_rule_ids as unknown[]).map(String) : [],
          divisionId: String(a.division_id ?? ""),
          effectiveFrom: isoDay(a.effective_from),
          effectiveTo: isoDay(a.effective_to),
          status: String(a.status ?? ""),
        })),
  };
}

function categoryIssues(category: Category | undefined, label: string): string[] {
  if (!category) return [`Accounts → Revenue Categories: no category found for ${label}`];
  if (category.status !== "Active") return [`Accounts → Revenue Categories: ${category.name} is inactive`];
  if (!category.incomeAccountId) return [`Accounts → Revenue Categories: ${category.name} has no income ledger`];
  return [];
}

function rulesetFor(setup: TaxSetup, category: Category | undefined, label: string): TaxRuleset {
  const issues = categoryIssues(category, label);
  const rules = category
    ? setup.rules.filter((r) => r.revenueCategoryId === category.id && r.status === "Active")
    : [];
  if (category && !rules.length) {
    issues.push(
      `Accounts → Tax/GST Master → Billing Points: pick the tax rules for ${label} (${category.name} has no rules of its own)`,
    );
  }
  return { issues, rules, taxes: setup.taxes };
}

/**
 * Tax rules picked on the mapping. They act as one slab set: each applies inside its own
 * amount range, and rules with an identical range add up (e.g. CGST + SGST).
 */
function selectedRuleset(setup: TaxSetup, category: Category | undefined, label: string, ruleIds: string[]): TaxRuleset {
  const issues = categoryIssues(category, label);
  const rules = setup.rules.filter((r) => r.id && ruleIds.includes(r.id) && r.status === "Active");
  if (rules.length < ruleIds.length) {
    issues.push(`Billing point ${label} uses a tax rule that was deleted or deactivated`);
  }
  return { issues, rules: rules.map((r) => ({ ...r, priority: 1 })), taxes: setup.taxes };
}

/**
 * Which revenue category (and so which tax rules) a billing point uses on a date.
 * An active Billing Point mapping wins; otherwise the point's default category, if any.
 */
export function resolveBillingPoint(
  setup: TaxSetup,
  point: BillingPointCode,
  date: string,
): BillingPointResolution {
  const def = BILLING_POINTS.find((p) => p.code === point);
  const label = billingPointLabel(point);
  const mapping = setup.applications
    .filter((a) => a.billingPoint === point && a.status === "Active" && inEffect(a.effectiveFrom, a.effectiveTo, date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

  if (mapping) {
    const category = setup.categories.find((c) => c.id === mapping.revenueCategoryId);
    const ruleset = mapping.taxRuleIds.length
      ? selectedRuleset(setup, category, label, mapping.taxRuleIds)
      : rulesetFor(setup, category, label);
    return {
      configured: true,
      categoryId: category?.id ?? "",
      categoryCode: category?.code ?? "",
      categoryName: category?.name ?? "",
      incomeAccountId: category?.incomeAccountId ?? "",
      divisionId: mapping.divisionId,
      priceIncludesTax: mapping.priceIncludesTax,
      source: "mapping",
      ruleset,
    };
  }

  if (!def?.defaultCategoryCode) return { configured: false };
  const category = setup.categories.find((c) => c.code === def.defaultCategoryCode && c.status === "Active");
  return {
    configured: true,
    categoryId: category?.id ?? "",
    categoryCode: def.defaultCategoryCode,
    categoryName: category?.name ?? def.defaultCategoryCode,
    incomeAccountId: category?.incomeAccountId ?? "",
    divisionId: "",
    priceIncludesTax: false,
    source: "default",
    ruleset: rulesetFor(setup, category, label),
  };
}

/**
 * Tax on `amount` for one date. Among rules whose band and dates cover the amount, the
 * lowest priority number wins; several rules at that priority (e.g. CGST + SGST) add up.
 * With `priceIncludesTax`, tax is carved out of the amount instead of added on top.
 */
export function quoteTax(
  ruleset: TaxRuleset,
  amount: number,
  date: string,
  opts: { priceIncludesTax?: boolean } = {},
): TaxQuote {
  if (ruleset.issues.length) return { ok: false, issue: ruleset.issues.join("; ") };

  let matches = ruleset.rules.filter(
    (r) =>
      inEffect(r.effectiveFrom, r.effectiveTo, date) &&
      (r.minimum === null || amount >= r.minimum) &&
      (r.maximum === null || amount <= r.maximum),
  );
  // Slabs "up to ₹X" and "₹X and above" share the boundary: ₹X belongs to the "up to" slab.
  if (matches.some((r) => r.maximum === amount)) {
    matches = matches.filter((r) => r.minimum !== amount || r.maximum === amount);
  }
  if (!matches.length) {
    return { ok: false, issue: `Accounts → Tax Rules: no active rule covers ${inr(amount)} on ${date}` };
  }
  const best = Math.min(...matches.map((r) => r.priority));
  const chosen = matches.filter((r) => r.priority === best);

  const picked: { rule: TaxRuleDef; tax: TaxDefinitionDef }[] = [];
  for (const rule of chosen) {
    const tax = ruleset.taxes.get(rule.taxId);
    if (!tax) return { ok: false, issue: `Tax rule ${rule.ruleCode} points to a tax that no longer exists` };
    if (tax.status !== "Active") return { ok: false, issue: `Tax ${tax.code} (rule ${rule.ruleCode}) is inactive` };
    if (!tax.outputAccountId) {
      return { ok: false, issue: `Accounts → Tax Master: ${tax.code} has no output tax ledger` };
    }
    picked.push({ rule, tax });
  }

  const pct = picked.filter((p) => p.tax.calculationType !== "Fixed").reduce((s, p) => s + p.tax.rate, 0);
  const fixed = picked.filter((p) => p.tax.calculationType === "Fixed").reduce((s, p) => s + p.tax.rate, 0);
  const taxable = opts.priceIncludesTax ? round2(Math.max(0, amount - fixed) / (1 + pct / 100)) : amount;

  const lines: TaxLine[] = picked.map(({ rule, tax }) => ({
    taxCode: tax.code,
    taxName: tax.name,
    taxType: tax.type,
    rate: tax.rate,
    calculationType: tax.calculationType,
    amount: tax.calculationType === "Fixed" ? round2(tax.rate) : round2((taxable * tax.rate) / 100),
    outputAccountId: tax.outputAccountId,
    ruleCode: rule.ruleCode,
  }));
  const taxAmount = opts.priceIncludesTax
    ? round2(amount - taxable)
    : round2(lines.reduce((s, l) => s + l.amount, 0));
  return { ok: true, taxAmount, taxableAmount: taxable, lines };
}

/** One-shot quote for a billing point. `configured: false` means the point carries no tax. */
export async function quoteBillingPoint(point: BillingPointCode, amount: number, date: string) {
  const setup = await loadTaxSetup();
  const resolution = resolveBillingPoint(setup, point, date);
  if (!resolution.configured) return { configured: false as const };
  return {
    configured: true as const,
    resolution,
    quote: quoteTax(resolution.ruleset, amount, date, { priceIncludesTax: resolution.priceIncludesTax }),
  };
}

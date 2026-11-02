import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteTax, resolveBillingPoint, type TaxSetup } from "./tax-resolver.js";

function tax(id: string, code: string, rate: number) {
  return { id, code, name: code, type: "GST", rate, calculationType: "Percentage", outputAccountId: "gst-ledger", status: "Active" };
}

function rule(categoryId: string, taxId: string, code: string, minimum: number | null, maximum: number | null, priority = 1) {
  return {
    id: code,
    revenueCategoryId: categoryId,
    taxId,
    ruleCode: code,
    ruleName: code,
    minimum,
    maximum,
    priority,
    effectiveFrom: "2026-04-01",
    effectiveTo: "",
    status: "Active",
  };
}

function setup(applications: TaxSetup["applications"] = []): TaxSetup {
  return {
    categories: [
      { id: "cat-room", code: "ROOM", name: "Room Revenue", incomeAccountId: "inc-room", status: "Active" },
      { id: "cat-food", code: "FOOD", name: "Food Revenue", incomeAccountId: "inc-food", status: "Active" },
    ],
    rules: [
      rule("cat-room", "t12", "TR-ROOM-12", 1001, 7500, 2),
      rule("cat-room", "t18", "TR-ROOM-18", 7501, null, 3),
      rule("cat-food", "t5", "TR-FNB-5", null, null, 1),
    ],
    taxes: new Map([
      ["t5", tax("t5", "GST5", 5)],
      ["t12", tax("t12", "GST12", 12)],
      ["t18", tax("t18", "GST18", 18)],
      ["c9", tax("c9", "CGST9", 9)],
      ["s9", tax("s9", "SGST9", 9)],
    ]),
    applications,
  };
}

function app(billingPoint: string, revenueCategoryId: string, extra: Partial<TaxSetup["applications"][number]> = {}) {
  return {
    billingPoint,
    revenueCategoryId,
    priceIncludesTax: false,
    taxRuleIds: [] as string[],
    divisionId: "",
    effectiveFrom: "2026-04-01",
    effectiveTo: "",
    status: "Active",
    ...extra,
  };
}

test("room charge falls back to the ROOM category when unmapped", () => {
  const r = resolveBillingPoint(setup(), "FO_ROOM_NIGHT", "2026-10-30");
  assert.ok(r.configured);
  assert.equal(r.source, "default");
  assert.equal(r.categoryCode, "ROOM");
});

test("F&B billing points carry no tax until mapped", () => {
  assert.equal(resolveBillingPoint(setup(), "FB_RESTAURANT_BILL", "2026-10-30").configured, false);
  assert.equal(resolveBillingPoint(setup(), "FB_ROOM_SERVICE", "2026-10-30").configured, false);
});

test("a mapping routes a billing point to its category's rules", () => {
  const r = resolveBillingPoint(setup([app("FB_RESTAURANT_BILL", "cat-food")]), "FB_RESTAURANT_BILL", "2026-10-30");
  assert.ok(r.configured);
  assert.equal(r.source, "mapping");
  const q = quoteTax(r.ruleset, 1000, "2026-10-30");
  assert.ok(q.ok);
  assert.equal(q.taxAmount, 50);
});

test("mappings only apply inside their effective dates", () => {
  const s = setup([app("FB_RESTAURANT_BILL", "cat-food", { effectiveFrom: "2026-11-01" })]);
  assert.equal(resolveBillingPoint(s, "FB_RESTAURANT_BILL", "2026-10-30").configured, false);
  assert.equal(resolveBillingPoint(s, "FB_RESTAURANT_BILL", "2026-11-01").configured, true);
});

test("the newest mapping in effect wins", () => {
  const s = setup([
    app("FB_ROOM_SERVICE", "cat-food", { effectiveFrom: "2026-04-01" }),
    app("FB_ROOM_SERVICE", "cat-room", { effectiveFrom: "2026-10-01" }),
  ]);
  const r = resolveBillingPoint(s, "FB_ROOM_SERVICE", "2026-10-30");
  assert.ok(r.configured);
  assert.equal(r.categoryCode, "ROOM");
});

test("inactive mappings are ignored", () => {
  const s = setup([app("FB_RESTAURANT_BILL", "cat-food", { status: "Inactive" })]);
  assert.equal(resolveBillingPoint(s, "FB_RESTAURANT_BILL", "2026-10-30").configured, false);
});

test("tax-inclusive prices are split, not increased", () => {
  const r = resolveBillingPoint(setup([app("FB_RESTAURANT_BILL", "cat-food")]), "FB_RESTAURANT_BILL", "2026-10-30");
  assert.ok(r.configured);
  const q = quoteTax(r.ruleset, 1050, "2026-10-30", { priceIncludesTax: true });
  assert.ok(q.ok);
  assert.equal(q.taxableAmount, 1000);
  assert.equal(q.taxAmount, 50);
  assert.equal(q.taxableAmount + q.taxAmount, 1050);
});

test("a mapping to a category without rules blocks instead of charging 0%", () => {
  const s = setup([app("FB_RESTAURANT_BILL", "cat-food")]);
  s.rules = s.rules.filter((r) => r.revenueCategoryId !== "cat-food");
  const r = resolveBillingPoint(s, "FB_RESTAURANT_BILL", "2026-10-30");
  assert.ok(r.configured);
  assert.equal(quoteTax(r.ruleset, 1000, "2026-10-30").ok, false);
});

test("rules picked on a billing point apply by their own amount ranges", () => {
  const s = setup([app("FB_RESTAURANT_BILL", "cat-food", { taxRuleIds: ["TR-ROOM-12", "TR-ROOM-18"] })]);
  const r = resolveBillingPoint(s, "FB_RESTAURANT_BILL", "2026-10-30");
  assert.ok(r.configured);
  const low = quoteTax(r.ruleset, 3000, "2026-10-30");
  const high = quoteTax(r.ruleset, 9000, "2026-10-30");
  assert.ok(low.ok && high.ok);
  assert.equal(low.taxAmount, 360);
  assert.equal(high.taxAmount, 1620);
});

test("picked rules with the same range add up (CGST + SGST)", () => {
  const s = setup([app("FO_ROOM_NIGHT", "cat-room", { taxRuleIds: ["R-C9", "R-S9"] })]);
  s.rules.push(rule("", "c9", "R-C9", null, null, 5), rule("", "s9", "R-S9", null, null, 7));
  const r = resolveBillingPoint(s, "FO_ROOM_NIGHT", "2026-10-30");
  assert.ok(r.configured);
  const q = quoteTax(r.ruleset, 1000, "2026-10-30");
  assert.ok(q.ok);
  assert.equal(q.taxAmount, 180);
  assert.equal(q.lines.length, 2);
});

test("a picked rule that was deleted blocks billing", () => {
  const s = setup([app("FO_ROOM_NIGHT", "cat-room", { taxRuleIds: ["gone"] })]);
  const r = resolveBillingPoint(s, "FO_ROOM_NIGHT", "2026-10-30");
  assert.ok(r.configured);
  assert.equal(quoteTax(r.ruleset, 1000, "2026-10-30").ok, false);
});

test("₹7,500 belongs to the 'up to ₹7,500' slab when the next slab starts at ₹7,500", () => {
  const s = setup([app("FO_ROOM_NIGHT", "cat-room", { taxRuleIds: ["C5", "S5", "C18", "S18"] })]);
  s.taxes.set("c25", tax("c25", "CGST5", 2.5));
  s.taxes.set("s25", tax("s25", "SGST5", 2.5));
  s.rules.push(
    rule("", "c25", "C5", 0, 7500),
    rule("", "s25", "S5", 0, 7500),
    rule("", "c9", "C18", 7500, null),
    rule("", "s9", "S18", 7500, null),
  );
  const r = resolveBillingPoint(s, "FO_ROOM_NIGHT", "2026-10-30");
  assert.ok(r.configured);
  const at = (amount: number) => {
    const q = quoteTax(r.ruleset, amount, "2026-10-30");
    assert.ok(q.ok);
    return q.taxAmount;
  };
  assert.equal(at(3500), 175);
  assert.equal(at(7500), 375);
  assert.equal(at(7500.5), 1350.1);
  assert.equal(at(9000), 1620);
});

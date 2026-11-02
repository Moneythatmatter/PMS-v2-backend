import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNightlyBilled,
  nightlyTariff,
  nightsThrough,
  quoteRoomTax,
  roomNightSourceId,
  type RoomTaxConfig,
} from "./room-night.service.js";
import type { Reservation } from "../../types/front-office.js";

function tax(id: string, code: string, rate: number, extra: Partial<{ outputAccountId: string; status: string; calculationType: string }> = {}) {
  return {
    id,
    code,
    name: code,
    type: "GST",
    rate,
    calculationType: extra.calculationType ?? "Percentage",
    outputAccountId: extra.outputAccountId ?? "ledger-gst",
    status: extra.status ?? "Active",
  };
}

function rule(taxId: string, ruleCode: string, minimum: number | null, maximum: number | null, priority = 1) {
  return { taxId, ruleCode, ruleName: ruleCode, minimum, maximum, priority, effectiveFrom: "2026-04-01", effectiveTo: "", status: "Active" };
}

/** Mirrors the live Shaw Hotel room slabs. */
const shaw: RoomTaxConfig = {
  issues: [],
  rules: [rule("t0", "TR-ROOM-0", 0, 1000, 1), rule("t12", "TR-ROOM-12", 1001, 7500, 2), rule("t18", "TR-ROOM-18", 7501, null, 3)],
  taxes: new Map([
    ["t0", tax("t0", "GST0", 0)],
    ["t12", tax("t12", "GST12", 12)],
    ["t18", tax("t18", "GST18", 18)],
  ]),
};

function stay(partial: Partial<Reservation> & { billingMode?: string }): Reservation {
  return { id: "R1", checkIn: "2026-10-28", checkOut: "2026-10-31", status: "Checked In", ...partial } as Reservation;
}

test("room tax follows the tariff slab", () => {
  const q12 = quoteRoomTax(shaw, 3000, "2026-10-30");
  assert.ok(q12.ok);
  assert.equal(q12.taxAmount, 360);
  assert.equal(q12.lines[0].taxCode, "GST12");

  const q18 = quoteRoomTax(shaw, 8000, "2026-10-30");
  assert.ok(q18.ok);
  assert.equal(q18.taxAmount, 1440);

  const q0 = quoteRoomTax(shaw, 900, "2026-10-30");
  assert.ok(q0.ok);
  assert.equal(q0.taxAmount, 0);
});

test("a tariff no rule covers is blocked, not posted untaxed", () => {
  const q = quoteRoomTax(shaw, 1000.5, "2026-10-30");
  assert.equal(q.ok, false);
});

test("nights before a rule takes effect are blocked", () => {
  const q = quoteRoomTax(shaw, 3000, "2026-03-31");
  assert.equal(q.ok, false);
});

test("missing output ledger or inactive tax blocks the posting", () => {
  const noLedger: RoomTaxConfig = { ...shaw, taxes: new Map([...shaw.taxes, ["t12", tax("t12", "GST12", 12, { outputAccountId: "" })]]) };
  const q1 = quoteRoomTax(noLedger, 3000, "2026-10-30");
  assert.equal(q1.ok, false);
  if (!q1.ok) assert.match(q1.issue, /output tax ledger/);

  const inactive: RoomTaxConfig = { ...shaw, taxes: new Map([...shaw.taxes, ["t12", tax("t12", "GST12", 12, { status: "Inactive" })]]) };
  assert.equal(quoteRoomTax(inactive, 3000, "2026-10-30").ok, false);
});

test("property-level setup issues block every night", () => {
  const q = quoteRoomTax({ ...shaw, issues: ["no ROOM category"] }, 3000, "2026-10-30");
  assert.equal(q.ok, false);
});

test("CGST + SGST at the same priority add up", () => {
  const split: RoomTaxConfig = {
    issues: [],
    rules: [rule("c", "R-C", 0, 7500, 1), rule("s", "R-S", 0, 7500, 1)],
    taxes: new Map([
      ["c", tax("c", "CGST6", 6)],
      ["s", tax("s", "SGST6", 6)],
    ]),
  };
  const q = quoteRoomTax(split, 2500, "2026-10-30");
  assert.ok(q.ok);
  assert.equal(q.taxAmount, 300);
  assert.equal(q.lines.length, 2);
});

test("only individual NIGHTLY stays are billed per night", () => {
  assert.equal(isNightlyBilled(stay({ billingMode: "NIGHTLY" })), true);
  assert.equal(isNightlyBilled(stay({ billingMode: "LEGACY_SEEDED" })), false);
  assert.equal(isNightlyBilled(stay({})), false);
  assert.equal(isNightlyBilled(stay({ billingMode: "NIGHTLY", groupId: "G1" })), false);
});

test("nights run from check-in through the audit night", () => {
  assert.deepEqual(nightsThrough(stay({}), "2026-10-30"), ["2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.deepEqual(nightsThrough(stay({ checkIn: "2026-11-02" }), "2026-10-30"), ["2026-10-30"]);
});

test("tariff falls back to total / nights", () => {
  assert.equal(nightlyTariff(stay({ roomRate: 2500 })), 2500);
  assert.equal(nightlyTariff(stay({ totalAmount: 9000, nights: 3 })), 3000);
});

test("each night has one deterministic key", () => {
  assert.equal(roomNightSourceId("R1", "2026-10-30"), "R1:2026-10-30");
});

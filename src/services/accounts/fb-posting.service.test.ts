import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFbPosting, type FbBill, type FbLedgers, type FbPayment } from "./fb-posting.service.js";

const ledgers: FbLedgers = {
  guestLedgerId: "guest-ledger",
  incomeFor: (point) =>
    point === "FB_RESTAURANT_BILL"
      ? { accountId: "restaurant-revenue", divisionId: "fnb" }
      : point === "FB_ROOM_SERVICE"
        ? { accountId: "room-service-revenue", divisionId: "fnb" }
        : { issue: `map ${point}` },
  taxAccountFor: (d) => (d.taxCode.startsWith("CGST") ? "cgst-out" : d.taxCode.startsWith("SGST") ? "sgst-out" : ""),
  paymentAccountFor: (mode) =>
    mode === "CASH" ? { accountId: "cash" } : mode === "UPI" ? { accountId: "upi-bank" } : { issue: `set ${mode}` },
  // 5% GST (2.5 + 2.5) on the taxable amount.
  taxSplit: (_point, taxable) => ({
    details: [
      { taxCode: "CGST2.5", amount: Math.round(taxable * 2.5) / 100 },
      { taxCode: "SGST2.5", amount: Math.round(taxable * 2.5) / 100 },
    ],
  }),
};

function bill(id: string, subtotal: number, tax: number, payments: FbPayment[], extra: Partial<FbBill> = {}): FbBill {
  const discount = extra.discount ?? 0;
  return {
    id,
    billNo: `B-${id}`,
    billingPoint: "FB_RESTAURANT_BILL",
    subtotal,
    discount,
    tax,
    total: subtotal + tax - discount,
    businessDate: "2026-11-01",
    payments,
    ...extra,
  };
}

const pay = (id: string, amount: number, mode = "CASH", voided = false): FbPayment => ({ id, paymentMethod: mode, amount, voided });

function line(b: ReturnType<typeof buildFbPosting>, accountId: string, entryType: "Dr" | "Cr") {
  return b.lines.filter((l) => l.accountId === accountId && l.entryType === entryType).reduce((s, l) => s + l.amount, 0);
}

const balanced = (b: ReturnType<typeof buildFbPosting>) =>
  Math.abs(b.lines.reduce((s, l) => s + (l.entryType === "Dr" ? l.amount : -l.amount), 0)) < 0.001;

test("paid restaurant bill: Dr payment ledgers, Cr income and split tax", () => {
  const b = buildFbPosting({
    bills: [bill("1", 1000, 50, [pay("p1", 600, "CASH"), pay("p2", 450, "UPI")])],
    latePayments: [],
    voids: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "cash", "Dr"), 600);
  assert.equal(line(b, "upi-bank", "Dr"), 450);
  assert.equal(line(b, "restaurant-revenue", "Cr"), 1000);
  assert.equal(line(b, "cgst-out", "Cr"), 25);
  assert.equal(line(b, "sgst-out", "Cr"), 25);
  assert.deepEqual(b.billIds, ["1"]);
  assert.deepEqual(b.paymentIds, ["p1", "p2"]);
  assert.ok(balanced(b));
});

test("discount is taken off income; tax follows the bill", () => {
  const b = buildFbPosting({
    bills: [bill("2", 1000, 50, [pay("p3", 950)], { discount: 100 })],
    latePayments: [],
    voids: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "restaurant-revenue", "Cr"), 900);
  assert.equal(line(b, "cgst-out", "Cr") + line(b, "sgst-out", "Cr"), 50);
  assert.equal(b.totals.discount, 100);
  assert.ok(balanced(b));
});

test("odd tax total: last tax line takes the paisa difference", () => {
  const b = buildFbPosting({ bills: [bill("3", 333, 16.65, [pay("p4", 349.65)])], latePayments: [], voids: [], ledgers });
  assert.equal(Math.round((line(b, "cgst-out", "Cr") + line(b, "sgst-out", "Cr")) * 100) / 100, 16.65);
  assert.ok(balanced(b));
});

test("untaxed bill and room-service bill paid at the POS", () => {
  const b = buildFbPosting({
    bills: [bill("4", 500, 0, [pay("p5", 500)]), bill("5", 200, 10, [pay("p6", 210)], { billingPoint: "FB_ROOM_SERVICE" })],
    latePayments: [],
    voids: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "restaurant-revenue", "Cr"), 500);
  assert.equal(line(b, "room-service-revenue", "Cr"), 200);
  assert.equal(line(b, "cash", "Dr"), 710);
  assert.ok(balanced(b));
});

test("unmapped payment mode blocks that bill", () => {
  const b = buildFbPosting({ bills: [bill("6", 100, 5, [pay("p7", 105, "CARD")])], latePayments: [], voids: [], ledgers });
  assert.ok(b.issues.some((i) => i.includes("CARD")));
  assert.deepEqual(b.billIds, []);
  assert.equal(b.lines.length, 0);
});

test("voided after posting and collected again go through the Guest Ledger", () => {
  const b = buildFbPosting({
    bills: [],
    latePayments: [pay("p9", 300, "UPI")],
    voids: [pay("p8", 300, "CASH", true)],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "cash", "Cr"), 300);
  assert.equal(line(b, "guest-ledger", "Dr"), 300);
  assert.equal(line(b, "upi-bank", "Dr"), 300);
  assert.equal(line(b, "guest-ledger", "Cr"), 300);
  assert.deepEqual(b.voidIds, ["p8"]);
  assert.deepEqual(b.paymentIds, ["p9"]);
  assert.ok(balanced(b));
});

test("paid in excess: difference goes to the Guest Ledger", () => {
  const b = buildFbPosting({ bills: [bill("7", 100, 5, [pay("p10", 110)])], latePayments: [], voids: [], ledgers });
  assert.equal(line(b, "guest-ledger", "Cr"), 5);
  assert.ok(balanced(b));
});

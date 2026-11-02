import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoPosting, type FoCharge, type FoLedgers, type FoPayment } from "./fo-posting.service.js";

const ledgers: FoLedgers = {
  guestLedgerId: "guest-ledger",
  guestDepositId: "guest-deposit",
  defaultReceivableId: "sundry-debtors",
  incomeFor: (point) =>
    point === "FO_ROOM_NIGHT"
      ? { accountId: "room-revenue", divisionId: "rooms" }
      : point === "FO_LAUNDRY"
        ? { accountId: "laundry-revenue", divisionId: null }
        : point === "FB_ROOM_SERVICE"
          ? { accountId: "fnb-revenue", divisionId: "fnb" }
          : { issue: `map ${point}` },
  taxAccountFor: (d) => d.outputAccountId || (d.taxCode.startsWith("CGST") ? "cgst-out" : d.taxCode.startsWith("SGST") ? "sgst-out" : ""),
  paymentAccountFor: (mode) =>
    mode === "CASH" ? { accountId: "cash" } : mode === "CARD" ? { accountId: "card-bank" } : { issue: `set ${mode}` },
  // 5% GST (2.5 + 2.5) carved out of the gross amount.
  inclusiveTax: (_point, gross) => {
    const taxable = Math.round((gross / 1.05) * 100) / 100;
    const half = Math.round(((gross - taxable) / 2) * 100) / 100;
    return {
      taxable,
      details: [
        { taxCode: "CGST2.5", amount: half },
        { taxCode: "SGST2.5", amount: half },
      ],
    };
  },
};

function moduleCharge(id: string, gross: number, sourceType: string, extra: Partial<FoCharge> = {}): FoCharge {
  return {
    id,
    chargeCategory: sourceType === "LAUNDRY" ? "LAUNDRY" : "FOOD_BEVERAGE",
    sourceType,
    amount: gross,
    taxAmount: 0,
    taxDetails: [],
    businessDate: "2026-11-01",
    source: "transaction",
    reversal: sourceType === "ROOM_SERVICE_REVERSAL",
    ...extra,
  };
}

function roomNight(id: string, amount: number, cgst: number, sgst: number, taxAmount = cgst + sgst): FoCharge {
  return {
    id,
    chargeCategory: "ROOM",
    sourceType: "ROOM_NIGHT",
    amount,
    taxAmount,
    taxDetails: [
      { taxCode: "CGST6", amount: cgst },
      { taxCode: "SGST6", amount: sgst },
    ],
    businessDate: "2026-11-01",
  };
}

function payment(id: string, amount: number, mode = "CASH", sourceModule = "FRONT_OFFICE", type = "PAYMENT"): FoPayment {
  return { id, transactionNumber: id, transactionType: type, paymentMethod: mode, amount, sourceModule };
}

function line(build: ReturnType<typeof buildFoPosting>, accountId: string, entryType: "Dr" | "Cr") {
  return build.lines.filter((l) => l.accountId === accountId && l.entryType === entryType).reduce((s, l) => s + l.amount, 0);
}

function balanced(build: ReturnType<typeof buildFoPosting>) {
  const dr = build.lines.filter((l) => l.entryType === "Dr").reduce((s, l) => s + l.amount, 0);
  const cr = build.lines.filter((l) => l.entryType === "Cr").reduce((s, l) => s + l.amount, 0);
  return Math.round(dr * 100) === Math.round(cr * 100);
}

test("room nights: Dr Guest Ledger, Cr room revenue (Rooms division) and each tax ledger", () => {
  const b = buildFoPosting({ charges: [roomNight("c1", 5000, 300, 300), roomNight("c2", 5000, 300, 300)], payments: [], adjustments: [], ledgers });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "guest-ledger", "Dr"), 11200);
  assert.equal(line(b, "room-revenue", "Cr"), 10000);
  assert.equal(line(b, "cgst-out", "Cr"), 600);
  assert.equal(line(b, "sgst-out", "Cr"), 600);
  assert.equal(b.lines.find((l) => l.accountId === "room-revenue")?.divisionId, "rooms");
  assert.deepEqual(b.chargeIds, ["c1", "c2"]);
  assert.ok(balanced(b));
});

test("tax saved on the charge wins over the tax master ledger", () => {
  const c = roomNight("c1", 1000, 60, 60);
  c.taxDetails[0].outputAccountId = "cgst-old-ledger";
  const b = buildFoPosting({ charges: [c], payments: [], adjustments: [], ledgers });
  assert.equal(line(b, "cgst-old-ledger", "Cr"), 60);
  assert.ok(balanced(b));
});

test("paisa difference between tax lines and folio tax is absorbed by the last tax line", () => {
  const b = buildFoPosting({ charges: [roomNight("c1", 4464.29, 267.86, 267.86, 535.71)], payments: [], adjustments: [], ledgers });
  assert.equal(line(b, "guest-ledger", "Dr"), 5000);
  assert.equal(line(b, "sgst-out", "Cr"), 267.85);
  assert.ok(balanced(b));
});

test("payments: Dr cash/bank from payment method, Cr Guest Ledger; advances go to deposits", () => {
  const b = buildFoPosting({
    charges: [],
    payments: [payment("p1", 1600, "CARD"), payment("p2", 2000, "CASH", "RESERVATION")],
    adjustments: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "card-bank", "Dr"), 1600);
  assert.equal(line(b, "guest-ledger", "Cr"), 1600);
  assert.equal(line(b, "cash", "Dr"), 2000);
  assert.equal(line(b, "guest-deposit", "Cr"), 2000);
  assert.equal(b.totals.advances, 2000);
  assert.ok(balanced(b));
});

test("refunds reverse the payment; adjustments move advances to the Guest Ledger at checkout", () => {
  const b = buildFoPosting({
    charges: [],
    payments: [payment("r1", 500, "CASH", "FRONT_OFFICE", "REFUND")],
    adjustments: [{ id: "a1", transactionType: "PAYMENT", amount: 2000 }],
    ledgers,
  });
  assert.equal(line(b, "guest-ledger", "Dr"), 500);
  assert.equal(line(b, "cash", "Cr"), 500);
  assert.equal(line(b, "guest-deposit", "Dr"), 2000);
  assert.equal(line(b, "guest-ledger", "Cr"), 2000);
  assert.deepEqual(b.adjustmentIds, ["a1"]);
  assert.ok(balanced(b));
});

test("missing mappings are reported and those rows are not posted", () => {
  const minibar: FoCharge = { ...roomNight("c9", 200, 0, 0, 0), chargeCategory: "MINIBAR", sourceType: "MANUAL_CHARGE", taxDetails: [] };
  const b = buildFoPosting({
    charges: [minibar],
    payments: [payment("p9", 100, "UPI")],
    adjustments: [],
    ledgers: { ...ledgers, guestLedgerId: "" },
  });
  assert.ok(b.issues.includes("map FO_MINIBAR"));
  assert.ok(b.issues.includes("set UPI"));
  assert.deepEqual(b.chargeIds, []);
  assert.deepEqual(b.paymentIds, []);
});

test("charge without guest ledger is blocked", () => {
  const b = buildFoPosting({ charges: [roomNight("c1", 1000, 60, 60)], payments: [], adjustments: [], ledgers: { ...ledgers, guestLedgerId: "" } });
  assert.ok(b.issues.some((i) => i.includes("Guest Ledger")));
  assert.deepEqual(b.chargeIds, []);
});

test("room service charged to the room: tax carved out of the gross, reversal posts the other way", () => {
  const b = buildFoPosting({
    charges: [moduleCharge("t1", 1050, "ROOM_SERVICE"), moduleCharge("t2", 210, "ROOM_SERVICE_REVERSAL")],
    payments: [],
    adjustments: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "guest-ledger", "Dr"), 1050);
  assert.equal(line(b, "fnb-revenue", "Cr"), 1000);
  assert.equal(line(b, "cgst-out", "Cr"), 25);
  assert.equal(line(b, "guest-ledger", "Cr"), 210);
  assert.equal(line(b, "fnb-revenue", "Dr"), 200);
  assert.equal(b.totals.charges, 800);
  assert.deepEqual(b.paymentIds, ["t1", "t2"]);
  assert.deepEqual(b.chargeIds, []);
  assert.ok(balanced(b));
});

test("payments and room charges voided after posting are posted back", () => {
  const b = buildFoPosting({
    charges: [moduleCharge("t3", 1050, "ROOM_SERVICE", { voided: true })],
    payments: [{ ...payment("p5", 1600, "CARD"), voided: true }, { ...payment("p6", 500, "CASH", "RESERVATION"), voided: true, adjusted: true }],
    adjustments: [],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(line(b, "fnb-revenue", "Dr"), 1000);
  assert.equal(line(b, "guest-ledger", "Cr"), 1050);
  assert.equal(line(b, "card-bank", "Cr"), 1600);
  assert.equal(line(b, "cash", "Cr"), 500);
  assert.equal(line(b, "guest-ledger", "Dr"), 2100);
  assert.equal(line(b, "guest-deposit", "Dr"), 0);
  assert.equal(b.totals.voided, 3150);
  assert.deepEqual(b.voidIds.sort(), ["p5", "p6", "t3"]);
  assert.deepEqual(b.paymentIds, []);
  assert.ok(balanced(b));
});

test("bill to company: Dr the party's receivable with the party, Cr Guest Ledger", () => {
  const b = buildFoPosting({
    charges: [],
    payments: [],
    adjustments: [],
    companyBills: [
      { id: "b1", billNo: "CB-1", partyId: "infosys", partyName: "Infosys", receivableAccountId: "infosys-ar", amount: 8000, businessDate: "2026-11-01" },
      { id: "b2", billNo: "CB-2", partyId: "metso", partyName: "Metso", receivableAccountId: null, amount: 2000, businessDate: "2026-11-01" },
    ],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  assert.equal(b.lines.find((l) => l.accountId === "infosys-ar")?.partyId, "infosys");
  assert.equal(b.lines.find((l) => l.accountId === "sundry-debtors")?.partyId, "metso");
  assert.equal(line(b, "guest-ledger", "Cr"), 10000);
  assert.equal(b.totals.companyBills, 10000);
  assert.deepEqual(b.companyBillIds, ["b1", "b2"]);
  assert.ok(balanced(b));
});

test("company bill voided after posting: Dr Guest Ledger, Cr the party's receivable", () => {
  const b = buildFoPosting({
    charges: [],
    payments: [],
    adjustments: [],
    companyBills: [
      { id: "b4", billNo: "CB-4", partyId: "infosys", partyName: "Infosys", receivableAccountId: "infosys-ar", amount: 3000, businessDate: "2026-10-30", voided: true },
    ],
    ledgers,
  });
  assert.deepEqual(b.issues, []);
  const ar = b.lines.find((l) => l.accountId === "infosys-ar");
  assert.equal(ar?.entryType, "Cr");
  assert.equal(ar?.partyId, "infosys");
  assert.equal(line(b, "guest-ledger", "Dr"), 3000);
  assert.equal(b.totals.voided, 3000);
  assert.equal(b.totals.companyBills, 0);
  assert.deepEqual(b.companyBillIds, []);
  assert.deepEqual(b.companyBillVoidIds, ["b4"]);
  assert.ok(balanced(b));
});

test("bill to company without any receivable ledger is blocked", () => {
  const b = buildFoPosting({
    charges: [],
    payments: [],
    adjustments: [],
    companyBills: [{ id: "b3", billNo: "CB-3", partyId: "x", partyName: "Reliance", receivableAccountId: null, amount: 100, businessDate: "2026-11-01" }],
    ledgers: { ...ledgers, defaultReceivableId: "" },
  });
  assert.ok(b.issues.some((i) => i.includes("Reliance")));
  assert.deepEqual(b.companyBillIds, []);
});

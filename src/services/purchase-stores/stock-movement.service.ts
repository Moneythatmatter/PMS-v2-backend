import { getRowById, insertRow, listRows, newId } from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import { ValidationError } from "../../errors/index.js";
import { upsertStockBalance } from "../../controllers/purchase-stores/receiving.js";

const T = psModel.tables;

type Warehouse = { id: string; name: string; code: string };
type Product = { id: string; productCode: string; productName: string; unit: string };
type Balance = { id: string; quantity: number; averageCost: number };
type Line = Record<string, unknown> & { id: string; materialId: string; itemCode: string; itemName: string; unit: string; unitCost: number };

type IssueRow = {
  id: string;
  issueNo: string;
  warehouse: string;
  department: string;
  status: string;
  lineItems: Line[];
};

type TransferRow = {
  id: string;
  transferNo: string;
  fromWarehouse: string;
  toWarehouse: string;
  status: string;
  lineItems: Line[];
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const today = () => new Date().toISOString().slice(0, 10);

async function resolveWarehouse(ref: unknown, label: string): Promise<Warehouse> {
  const key = String(ref ?? "").trim().toLowerCase();
  if (!key) throw new ValidationError(`Choose the ${label}`);
  const rows = await listRows<Warehouse>(T.warehouses, { limit: 500 });
  const found = rows.find((w) => w.id.toLowerCase() === key || w.name.toLowerCase() === key || w.code?.toLowerCase() === key);
  if (!found) throw new ValidationError(`${label[0].toUpperCase()}${label.slice(1)} "${String(ref)}" was not found`);
  return found;
}

async function balanceOf(materialId: string, warehouseId: string) {
  const rows = await listRows<Balance>(T.stockBalances, {
    filters: { material_id: materialId, warehouse_id: warehouseId },
    limit: 1,
  });
  return rows[0] ?? null;
}

async function alreadyPosted(transactionNo: string, movementType: string) {
  const rows = await listRows<{ id: string }>(T.stockLedger, {
    filters: { transaction_no: transactionNo, movement_type: movementType },
    limit: 1,
  });
  return rows.length > 0;
}

/** Fills item details and current stock from the masters; the client only sends material + quantity. */
async function normalizeLines(raw: unknown, warehouseId: string, qtyKey: string, availableKey: string) {
  const input = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const lines: Line[] = [];
  for (const [idx, item] of input.entries()) {
    const materialId = String(item.materialId ?? "").trim();
    const qty = round(Number(item[qtyKey]));
    if (!materialId) throw new ValidationError(`Line ${idx + 1}: choose a material`);
    if (seen.has(materialId)) throw new ValidationError(`Line ${idx + 1}: material is listed more than once`);
    seen.add(materialId);
    const product = await getRowById<Product>(T.products, materialId);
    if (!product) throw new ValidationError(`Line ${idx + 1}: material not found in the product master`);
    if (!(qty > 0)) throw new ValidationError(`${product.productName}: quantity must be greater than 0`);
    const balance = await balanceOf(materialId, warehouseId);
    lines.push({
      ...item,
      id: String(item.id ?? "") || newId("LN"),
      materialId,
      itemCode: product.productCode,
      itemName: product.productName,
      unit: product.unit,
      unitCost: Number(balance?.averageCost ?? 0),
      [qtyKey]: qty,
      [availableKey]: Number(balance?.quantity ?? 0),
    });
  }
  const totalValue = round(lines.reduce((s, l) => s + Number(l[qtyKey]) * l.unitCost, 0), 2);
  return { lines, totalValue };
}

async function assertStockFor(lines: Line[], warehouseId: string, qtyKey: string, docNo: string) {
  for (const line of lines) {
    const onHand = Number((await balanceOf(line.materialId, warehouseId))?.quantity ?? 0);
    const qty = Number(line[qtyKey]);
    if (qty > onHand) {
      throw new ValidationError(`${docNo}: only ${onHand} ${line.unit} of ${line.itemName} in stock, ${qty} needed`);
    }
  }
}

async function postLines(params: {
  lines: Line[];
  warehouseId: string;
  qtyKey: string;
  direction: "in" | "out";
  docNo: string;
  movementType: string;
  remarks: string;
}) {
  if (await alreadyPosted(params.docNo, params.movementType)) return;
  for (const line of params.lines) {
    const qty = Number(line[params.qtyKey]);
    if (!(qty > 0)) continue;
    const signed = params.direction === "in" ? qty : -qty;
    const cost = params.direction === "in" ? Number(line.unitCost) : Number((await balanceOf(line.materialId, params.warehouseId))?.averageCost ?? line.unitCost);
    const balanceQty = await upsertStockBalance(line.materialId, params.warehouseId, signed, cost);
    await insertRow(T.stockLedger, {
      id: newId("SL"),
      transactionDate: today(),
      transactionNo: params.docNo,
      movementType: params.movementType,
      materialId: line.materialId,
      warehouseId: params.warehouseId,
      quantityIn: signed > 0 ? qty : 0,
      quantityOut: signed < 0 ? qty : 0,
      balanceQty,
      remarks: `${params.remarks} — ${line.itemName}`,
    });
  }
}

// ── Issues ────────────────────────────────────────────────────────────────

const ISSUE_EDITABLE = new Set(["Draft", "Pending Approval"]);

export async function prepareIssueCreate(body: Record<string, unknown>) {
  const wh = await resolveWarehouse(body.warehouse, "issuing warehouse");
  body.warehouse = wh.name;
  const { lines, totalValue } = await normalizeLines(body.lineItems, wh.id, "requestedQty", "availableStock");
  for (const l of lines) l.issuedQty = 0;
  body.lineItems = lines;
  body.totalValue = totalValue;
  body.status = body.status === "Pending Approval" ? "Pending Approval" : "Draft";
  if (body.status === "Pending Approval" && lines.length === 0) throw new ValidationError("Add at least one material before submitting");
  delete body.approvedBy;
  delete body.issuedBy;
}

export async function prepareIssueUpdate(id: string, body: Record<string, unknown>) {
  const prev = await getRowById<IssueRow>(T.stockIssues, id);
  if (!prev) throw new ValidationError("Issue slip not found");
  if (!ISSUE_EDITABLE.has(prev.status)) {
    throw new ValidationError(`${prev.issueNo} is ${prev.status.toLowerCase()} and can't be changed`);
  }
  delete body.issueNo;

  const next = String(body.status ?? prev.status);
  if (!["Draft", "Pending Approval", "Issued", "Cancelled"].includes(next)) throw new ValidationError(`Unknown status "${next}"`);
  if (next === "Issued" && prev.status !== "Pending Approval") throw new ValidationError("Submit the slip for approval before issuing");

  const wh = await resolveWarehouse(body.warehouse ?? prev.warehouse, "issuing warehouse");
  body.warehouse = wh.name;
  const { lines, totalValue } = await normalizeLines(body.lineItems ?? prev.lineItems, wh.id, "requestedQty", "availableStock");
  if (next !== "Draft" && next !== "Cancelled" && lines.length === 0) throw new ValidationError("Add at least one material first");

  if (next === "Issued") {
    await assertStockFor(lines, wh.id, "requestedQty", prev.issueNo);
    for (const l of lines) l.issuedQty = l.requestedQty;
    await postLines({
      lines,
      warehouseId: wh.id,
      qtyKey: "issuedQty",
      direction: "out",
      docNo: prev.issueNo,
      movementType: "Issue",
      remarks: `Issued to ${prev.department}`,
    });
  } else {
    for (const l of lines) l.issuedQty = 0;
  }
  body.lineItems = lines;
  body.totalValue = totalValue;
}

export async function assertIssueDeletable(id: string) {
  const prev = await getRowById<IssueRow>(T.stockIssues, id);
  if (prev && prev.status === "Issued") {
    throw new ValidationError(`${prev.issueNo} has been issued from stock and can't be deleted`);
  }
}

// ── Transfers ─────────────────────────────────────────────────────────────

const TRANSFER_FLOW: Record<string, string[]> = {
  Draft: ["Draft", "Pending Approval", "Cancelled"],
  "Pending Approval": ["Pending Approval", "Draft", "In Transit", "Cancelled"],
  "In Transit": ["In Transit", "Completed", "Cancelled"],
};

async function transferWarehouses(from: unknown, to: unknown) {
  const source = await resolveWarehouse(from, "source warehouse");
  const destination = await resolveWarehouse(to, "destination warehouse");
  if (source.id === destination.id) throw new ValidationError("Source and destination warehouse must be different");
  return { source, destination };
}

export async function prepareTransferCreate(body: Record<string, unknown>) {
  const { source, destination } = await transferWarehouses(body.fromWarehouse, body.toWarehouse);
  body.fromWarehouse = source.name;
  body.toWarehouse = destination.name;
  const { lines, totalValue } = await normalizeLines(body.lineItems, source.id, "transferQty", "availableAtSource");
  body.lineItems = lines;
  body.totalValue = totalValue;
  body.status = body.status === "Pending Approval" ? "Pending Approval" : "Draft";
  if (body.status === "Pending Approval" && lines.length === 0) throw new ValidationError("Add at least one material before submitting");
  delete body.dispatchedBy;
  delete body.receivedBy;
}

export async function prepareTransferUpdate(id: string, body: Record<string, unknown>) {
  const prev = await getRowById<TransferRow>(T.stockTransfers, id);
  if (!prev) throw new ValidationError("Transfer note not found");
  const allowed = TRANSFER_FLOW[prev.status];
  if (!allowed) throw new ValidationError(`${prev.transferNo} is ${prev.status.toLowerCase()} and can't be changed`);
  delete body.transferNo;

  const next = String(body.status ?? prev.status);
  if (!allowed.includes(next)) throw new ValidationError(`${prev.transferNo} can't move from ${prev.status} to ${next}`);

  // Once dispatched, the warehouses and items are fixed — stock has already left the source.
  if (prev.status === "In Transit") {
    for (const key of ["fromWarehouse", "toWarehouse", "fromStore", "toStore", "lineItems", "totalValue"]) delete body[key];
    const { source, destination } = await transferWarehouses(prev.fromWarehouse, prev.toWarehouse);
    if (next === "Completed") {
      await postLines({
        lines: prev.lineItems,
        warehouseId: destination.id,
        qtyKey: "transferQty",
        direction: "in",
        docNo: prev.transferNo,
        movementType: "Transfer In",
        remarks: `Received from ${source.name}`,
      });
    } else if (next === "Cancelled") {
      await postLines({
        lines: prev.lineItems,
        warehouseId: source.id,
        qtyKey: "transferQty",
        direction: "in",
        docNo: prev.transferNo,
        movementType: "Transfer Return",
        remarks: `Transfer cancelled in transit — returned to ${source.name}`,
      });
    }
    return;
  }

  const { source, destination } = await transferWarehouses(body.fromWarehouse ?? prev.fromWarehouse, body.toWarehouse ?? prev.toWarehouse);
  body.fromWarehouse = source.name;
  body.toWarehouse = destination.name;
  const { lines, totalValue } = await normalizeLines(body.lineItems ?? prev.lineItems, source.id, "transferQty", "availableAtSource");
  if (next !== "Draft" && next !== "Cancelled" && lines.length === 0) throw new ValidationError("Add at least one material first");

  if (next === "In Transit") {
    await assertStockFor(lines, source.id, "transferQty", prev.transferNo);
    await postLines({
      lines,
      warehouseId: source.id,
      qtyKey: "transferQty",
      direction: "out",
      docNo: prev.transferNo,
      movementType: "Transfer Out",
      remarks: `Dispatched to ${destination.name}`,
    });
  }
  body.lineItems = lines;
  body.totalValue = totalValue;
}

export async function assertTransferDeletable(id: string) {
  const prev = await getRowById<TransferRow>(T.stockTransfers, id);
  if (prev && (prev.status === "In Transit" || prev.status === "Completed")) {
    throw new ValidationError(`${prev.transferNo} has moved stock and can't be deleted`);
  }
}

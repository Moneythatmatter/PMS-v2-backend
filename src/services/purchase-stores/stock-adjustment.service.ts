import { getRowById, insertRow, listRows, newId } from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import { ValidationError } from "../../errors/index.js";
import { upsertStockBalance } from "../../controllers/purchase-stores/receiving.js";

const T = psModel.tables;

type AdjustmentRow = {
  id: string;
  adjustmentNo: string;
  adjustmentDate?: string;
  materialId: string;
  warehouseId: string;
  systemQty: number;
  actualQty: number;
  difference: number;
  reason?: string;
  status: string;
};

type BalanceRow = { id: string; quantity: number; averageCost: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

async function currentBalance(materialId: string, warehouseId: string) {
  const rows = await listRows<BalanceRow>(T.stockBalances, {
    filters: { material_id: materialId, warehouse_id: warehouseId },
    limit: 1,
  });
  return rows[0] ?? null;
}

async function alreadyPosted(adjustmentNo: string) {
  const rows = await listRows<{ id: string }>(T.stockLedger, {
    filters: { transaction_no: adjustmentNo, movement_type: "Adjustment" },
    limit: 1,
  });
  return rows.length > 0;
}

/** Moves the store balance by the adjustment difference and writes one ledger line. */
async function postAdjustment(adj: AdjustmentRow) {
  if (await alreadyPosted(adj.adjustmentNo)) return;
  const diff = round(Number(adj.difference));
  if (!diff) return;

  const balance = await currentBalance(adj.materialId, adj.warehouseId);
  const onHand = Number(balance?.quantity ?? 0);
  if (onHand + diff < 0) {
    throw new ValidationError(
      `Cannot approve ${adj.adjustmentNo}: stock is now ${onHand}, removing ${Math.abs(diff)} would go below zero. Reject it and raise a new count.`,
    );
  }

  const balanceQty = await upsertStockBalance(adj.materialId, adj.warehouseId, diff, Number(balance?.averageCost ?? 0));
  await insertRow(T.stockLedger, {
    id: newId("SL"),
    transactionDate: new Date().toISOString().slice(0, 10),
    transactionNo: adj.adjustmentNo,
    movementType: "Adjustment",
    materialId: adj.materialId,
    warehouseId: adj.warehouseId,
    quantityIn: diff > 0 ? diff : 0,
    quantityOut: diff < 0 ? -diff : 0,
    balanceQty,
    remarks: `Stock adjustment — ${adj.reason || "No reason"} (system ${adj.systemQty}, counted ${adj.actualQty})`,
  });
}

export async function prepareAdjustmentCreate(body: Record<string, unknown>) {
  const materialId = String(body.materialId ?? "").trim();
  const warehouseId = String(body.warehouseId ?? "").trim();
  const actualQty = round(Number(body.actualQty));
  if (!materialId || !warehouseId) throw new ValidationError("Choose a material and store");
  if (!Number.isFinite(actualQty) || actualQty < 0) throw new ValidationError("Counted quantity must be zero or more");

  const balance = await currentBalance(materialId, warehouseId);
  if (!balance) throw new ValidationError("This material has no stock record in that store");
  const systemQty = round(Number(balance.quantity));
  const difference = round(actualQty - systemQty);
  if (!difference) throw new ValidationError("Counted quantity matches the system — no adjustment needed");

  Object.assign(body, { materialId, warehouseId, systemQty, actualQty, difference });
  if (body.status !== "Draft") body.status = "Pending Approval";
  delete body.approvedBy;
  delete body.ledgerRef;
}

export async function prepareAdjustmentUpdate(id: string, body: Record<string, unknown>) {
  const prev = await getRowById<AdjustmentRow>(T.stockAdjustments, id);
  if (!prev) throw new ValidationError("Adjustment not found");
  if (prev.status === "Approved" || prev.status === "Rejected") {
    throw new ValidationError(`${prev.adjustmentNo} is already ${prev.status.toLowerCase()} and can't be changed`);
  }

  // Quantities are fixed once submitted; only status and approver move forward.
  for (const key of ["materialId", "warehouseId", "systemQty", "actualQty", "difference", "adjustmentNo"]) delete body[key];

  if (body.status === "Approved") {
    await postAdjustment(prev);
    body.ledgerRef = prev.adjustmentNo;
  } else {
    delete body.ledgerRef;
  }
}

export async function assertAdjustmentDeletable(id: string) {
  const prev = await getRowById<AdjustmentRow>(T.stockAdjustments, id);
  if (prev?.status === "Approved") {
    throw new ValidationError(`${prev.adjustmentNo} is approved and already posted to stock — it can't be deleted`);
  }
}

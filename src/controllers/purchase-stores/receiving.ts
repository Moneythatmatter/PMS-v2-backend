import type { Request, Response } from "express";
import {
  getRowById,
  insertRow,
  listRows,
  newId,
  updateRow,
} from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

const T = psModel.tables;

type BatchAlloc = {
  batchNumber: string;
  expiryDate?: string;
  mfgDate?: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  storageWarehouse?: string;
  storageLocation?: string;
};

type GrnLine = {
  materialId?: string;
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unitRate: number;
  receivedValue: number;
  batchAllocations?: BatchAlloc[];
};

async function findProductById(id: string) {
  if (!id?.trim()) return null;
  const rows = await listRows<{ id: string; productCode: string; productName: string; category: string }>(
    T.products,
    { filters: { id }, limit: 1 },
  );
  return rows[0] ?? null;
}

async function findProductByCode(code: string) {
  if (!code?.trim()) return null;
  const rows = await listRows<{ id: string; productCode: string; productName: string; category: string }>(
    T.products,
    { filters: { product_code: code }, limit: 1 },
  );
  return rows[0] ?? null;
}

async function resolveProduct(line: GrnLine) {
  const byId = line.materialId ? await findProductById(line.materialId) : null;
  if (byId) return byId;
  return findProductByCode(line.productCode);
}

async function findWarehouseByName(name: string) {
  const rows = await listRows<{ id: string; name: string; code: string }>(T.warehouses, { limit: 50 });
  const n = name.toLowerCase();
  return rows.find((w) => w.name.toLowerCase() === n || w.code.toLowerCase() === n) ?? rows[0] ?? null;
}

async function upsertStockBalance(materialId: string, warehouseId: string, qtyIn: number, unitCost: number) {
  const existing = await listRows<{
    id: string;
    quantity: number;
    averageCost: number;
  }>(T.stockBalances, {
    filters: { material_id: materialId, warehouse_id: warehouseId },
    limit: 1,
  });

  const now = new Date().toISOString();
  if (existing[0]) {
    const prev = existing[0];
    const newQty = Number(prev.quantity) + qtyIn;
    const newAvg =
      newQty > 0
        ? (Number(prev.quantity) * Number(prev.averageCost) + qtyIn * unitCost) / newQty
        : unitCost;
    await updateRow(T.stockBalances, prev.id, {
      quantity: newQty,
      averageCost: Math.round(newAvg * 100) / 100,
      lastMovementAt: now,
      status: "Active",
    });
    return newQty;
  }

  await insertRow(T.stockBalances, {
    id: newId("SB"),
    materialId,
    warehouseId,
    quantity: qtyIn,
    averageCost: unitCost,
    lastMovementAt: now,
    status: "Active",
  });
  return qtyIn;
}

/** Post accepted GRN batches to stock ledger + batches after QC pass. */
export async function postGrnStock(params: {
  grnNumber: string;
  poNumber: string;
  supplierName: string;
  warehouse: string;
  items: GrnLine[];
}) {
  const posted: string[] = [];

  for (const line of params.items) {
    const product = await resolveProduct(line);
    if (!product) {
      console.warn(`[PS] postGrnStock: skipped line — unknown material ${line.materialId ?? line.productCode}`);
      continue;
    }

    const warehouseName = params.warehouse;
    const wh = await findWarehouseByName(warehouseName);
    if (!wh) continue;

    const allocations = line.batchAllocations?.length
      ? line.batchAllocations
      : [
          {
            batchNumber: `B-${line.productCode}-${Date.now().toString(36).slice(-4)}`,
            receivedQty: line.receivedQty,
            acceptedQty: line.acceptedQty,
            rejectedQty: line.rejectedQty,
            storageWarehouse: warehouseName,
          },
        ];

    for (const batch of allocations) {
      const qtyIn = Number(batch.acceptedQty ?? 0);
      if (qtyIn <= 0) continue;

      const balanceQty = await upsertStockBalance(
        product.id,
        wh.id,
        qtyIn,
        Number(line.unitRate ?? 0),
      );

      await insertRow(T.stockLedger, {
        id: newId("SL"),
        transactionDate: new Date().toISOString().slice(0, 10),
        transactionNo: params.grnNumber,
        movementType: "GRN",
        materialId: product.id,
        warehouseId: wh.id,
        quantityIn: qtyIn,
        quantityOut: 0,
        balanceQty,
        remarks: `GRN receipt — ${line.productName} batch ${batch.batchNumber}`,
      });

      const expiry = batch.expiryDate ?? "";
      const daysRemaining = expiry
        ? Math.max(0, Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000))
        : 0;

      await insertRow(T.batches, {
        id: newId("BAT"),
        batchNumber: batch.batchNumber,
        itemCode: line.productCode,
        itemName: line.productName,
        category: line.category,
        warehouse: warehouseName,
        zone: "—",
        rack: "—",
        shelf: "—",
        bin: batch.storageLocation ?? "—",
        supplier: params.supplierName,
        grnNumber: params.grnNumber,
        poNumber: params.poNumber,
        mfgDate: batch.mfgDate ?? new Date().toISOString().slice(0, 10),
        expiryDate: expiry || "—",
        totalShelfLifeDays: daysRemaining,
        daysRemaining,
        availableQty: qtyIn,
        reservedQty: 0,
        issuedQty: 0,
        unitCost: Number(line.unitRate ?? 0),
        stockValue: qtyIn * Number(line.unitRate ?? 0),
        unit: line.unit,
        status: "Fresh",
        isFefoRecommended: false,
        qualityPassed: true,
        movements: [],
      });

      posted.push(`${line.productCode}/${batch.batchNumber}`);
    }
  }

  return posted;
}

function flattenGrnItemsForQc(items: GrnLine[]) {
  return items.map((line, idx) => ({
    id: `qi-${idx}`,
    materialId: line.materialId ?? "",
    productCode: line.productCode,
    productName: line.productName,
    receivedQty: line.receivedQty,
    inspectedQty: line.receivedQty,
    acceptedQty: line.acceptedQty,
    rejectedQty: line.rejectedQty,
    qualityResult: "Pending" as const,
  }));
}

/** POST /grns — create GRN + pending QC task (no vendor invoice required). */
export async function createGrn(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const items = (body.items as GrnLine[]) ?? [];
    const totalAmount = items.reduce((s, l) => s + Number(l.receivedValue ?? 0), 0);

    const grnPayload = {
      ...body,
      itemCount: items.length,
      totalAmount,
      status: body.status ?? "Pending",
      inspectionStatus: body.inspectionStatus ?? "Pending",
      inspectionDetails: body.inspectionDetails ?? {
        status: "Pending",
        inspector: "Awaiting QC Auditor",
        inspectionDate: "Pending",
        comments: "Goods physically received. Awaiting quality inspection.",
      },
    };

    if (!grnPayload.grnNumber) {
      const year = new Date().getFullYear();
      grnPayload.grnNumber = `GRN-${year}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    }
    if (!grnPayload.id) grnPayload.id = newId("GRN");

    const grn = await insertRow<Record<string, unknown>>(T.grns, grnPayload);

    const grnNumber = String(grn.grnNumber ?? grnPayload.grnNumber);
    const poNumber = String(grn.poNumber ?? body.poNumber ?? "");
    const supplierName = String(grn.supplierName ?? body.supplierName ?? "");
    const warehouse = String(grn.warehouse ?? body.warehouse ?? "");

    await insertRow(T.qualityInspections, {
      id: newId("QI"),
      inspectionNumber: `QI-${Date.now().toString(36).slice(-5).toUpperCase()}`,
      inspectionDate: new Date().toISOString().slice(0, 10),
      grnNumber,
      poNumber,
      supplierName,
      warehouse,
      inspectorName: "Awaiting Assignment",
      itemsInspectedCount: 0,
      itemsCount: items.length,
      result: "Pending",
      status: "Inspection Pending",
      inspectionType: "Incoming GRN Receipt",
      priority: "Medium",
      age: "Just now",
      isOverdue: false,
      generalRemarks: `Auto-created from ${grnNumber}`,
      items: flattenGrnItemsForQc(items),
      checklist: [],
      attachments: [],
      history: [
        {
          timestamp: new Date().toISOString(),
          user: "System",
          action: "QC task created from GRN",
          status: "Pending",
        },
      ],
    });

    return ok(res, grn, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

/** PUT/PATCH quality inspection — post stock when completed with pass/partial. */
export async function updateQualityInspection(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;

    const prev = await getRowById<{
      grnNumber: string;
      result: string;
      status: string;
    }>(T.qualityInspections, id);
    if (!prev) return fail(res, "Not found", 404);

    const row = await updateRow<Record<string, unknown>>(T.qualityInspections, id, body);

    const newStatus = String(body.status ?? prev.status);
    const newResult = String(body.result ?? prev.result);
    const wasCompleted =
      newStatus === "Completed" &&
      prev.status !== "Completed" &&
      (newResult === "Passed" || newResult === "Partial" || newResult === "Partially Accepted");

    if (wasCompleted && prev.grnNumber) {
      const grns = await listRows<Record<string, unknown>>(T.grns, {
        filters: { grn_number: prev.grnNumber },
        limit: 1,
      });
      const grn = grns[0];
      if (grn) {
        const items = (grn.items as GrnLine[]) ?? [];
        const qiItems =
          (body.items as Array<{
            materialId?: string;
            productCode: string;
            acceptedQty: number;
            rejectedQty: number;
          }>) ?? [];

        const mergedItems = items.map((line) => {
          const qi =
            qiItems.find((q) => q.materialId && q.materialId === line.materialId) ??
            qiItems.find((q) => q.productCode === line.productCode);
          const acceptedQty = qi ? Number(qi.acceptedQty) : line.acceptedQty;
          const rejectedQty = qi ? Number(qi.rejectedQty) : line.rejectedQty;
          const ratio = line.receivedQty > 0 ? acceptedQty / line.receivedQty : 0;
          return {
            ...line,
            acceptedQty,
            rejectedQty,
            qcStatus:
              rejectedQty > 0 && acceptedQty > 0
                ? "Partial"
                : acceptedQty > 0
                  ? "Passed"
                  : "Failed",
            batchAllocations: (line.batchAllocations ?? []).map((b) => {
              const batchAccepted = Math.round(Number(b.receivedQty) * ratio);
              return {
                ...b,
                acceptedQty: batchAccepted,
                rejectedQty: Number(b.receivedQty) - batchAccepted,
                qcStatus: batchAccepted > 0 ? ("Passed" as const) : ("Failed" as const),
              };
            }),
          };
        });

        await postGrnStock({
          grnNumber: String(grn.grnNumber),
          poNumber: String(grn.poNumber),
          supplierName: String(grn.supplierName),
          warehouse: String(grn.warehouse),
          items: mergedItems,
        });

        await updateRow(T.grns, String(grn.id), {
          status: "Completed",
          inspectionStatus: newResult === "Passed" ? "Passed" : "Partially Accepted",
          inspectionDetails: {
            status: newResult === "Passed" ? "Passed" : "Partially Accepted",
            inspector: String(body.inspectorName ?? "QC Auditor"),
            inspectionDate: new Date().toISOString().slice(0, 10),
            comments: String(body.generalRemarks ?? body.remarks ?? "QC completed"),
          },
          items: mergedItems,
        });
      }
    }

    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

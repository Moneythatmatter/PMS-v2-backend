import { deleteRow, getRowById, insertRow, listRows, newId, updateRow, } from "../../models/front-office/base.js";
import { psModel } from "../../models/purchase-stores/index.js";
import * as requisitions from "../../models/purchase-stores/requisitions.js";
import { withPsDocumentDefaults } from "../../utils/purchase-stores-docs.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/index.js";
import { fromError, ok } from "../../utils/response.js";
const T = psModel.tables;
export const PR_STATUS = {
    DRAFT: "Draft",
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    IN_SOURCING: "In Sourcing",
    PARTIALLY_ORDERED: "Partially Ordered",
    CLOSED: "Closed",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
};
export const PR_DOC = {
    numberField: "prNumber",
    prefix: "PR",
    dateDefaults: { requestDate: "today", requiredDate: "today" },
};
export const RFQ_DOC = {
    numberField: "rfqNumber",
    prefix: "RFQ",
    dateDefaults: { rfqDate: "today", closingDate: "today" },
};
export const PO_DOC = {
    numberField: "poNumber",
    prefix: "PO",
    dateDefaults: { orderDate: "today" },
};
/** Statuses derived from linked RFQs / POs — never set by hand. */
const SYSTEM_PR_STATUSES = new Set([
    PR_STATUS.IN_SOURCING,
    PR_STATUS.PARTIALLY_ORDERED,
    PR_STATUS.CLOSED,
]);
/** Statuses the sourcing lifecycle is allowed to move between. */
const LIFECYCLE_PR_STATUSES = new Set([
    PR_STATUS.APPROVED,
    PR_STATUS.IN_SOURCING,
    PR_STATUS.PARTIALLY_ORDERED,
    PR_STATUS.CLOSED,
]);
/** PR statuses from which new sourcing (RFQ or direct PO) may start. */
const SOURCEABLE_PR_STATUSES = new Set([
    PR_STATUS.APPROVED,
    PR_STATUS.PARTIALLY_ORDERED,
]);
const INACTIVE_RFQ_STATUSES = new Set(["cancelled", "closed", "converted to po"]);
export const RFQ_STATUS = {
    VENDOR_SELECTED: "Vendor Selected",
    CONVERTED_TO_PO: "Converted to PO",
    CLOSED: "Closed",
};
const norm = (v) => String(v ?? "").trim().toLowerCase();
const trimOrEmpty = (v) => String(v ?? "").trim();
function isRfqOpen(rfq) {
    return !INACTIVE_RFQ_STATUSES.has(norm(rfq.status));
}
function isPoActive(po) {
    return norm(po.status) !== "cancelled";
}
/** Index of the PR item a PO line fulfils; legacy lines without prItemId match by material. */
function matchPrItemIndex(items, line) {
    const byId = trimOrEmpty(line.prItemId);
    if (byId) {
        const idx = items.findIndex((i) => i.id === byId);
        if (idx >= 0)
            return idx;
    }
    const material = norm(line.materialId);
    if (material) {
        const idx = items.findIndex((i) => norm(i.materialId) === material);
        if (idx >= 0)
            return idx;
    }
    const code = norm(line.productCode || line.itemCode);
    if (code) {
        const idx = items.findIndex((i) => norm(i.productCode) === code);
        if (idx >= 0)
            return idx;
    }
    const name = norm(line.productName || line.itemDescription);
    if (name)
        return items.findIndex((i) => norm(i.item) === name);
    return -1;
}
export function computeFulfillment(pr, pos, excludePoId) {
    const items = pr.requestedItems ?? [];
    const ordered = items.map(() => 0);
    for (const po of pos) {
        if (po.id === excludePoId || !isPoActive(po))
            continue;
        for (const line of po.items ?? []) {
            const idx = matchPrItemIndex(items, line);
            if (idx >= 0)
                ordered[idx] += Number(line.quantity) || 0;
        }
    }
    const rows = items.map((item, idx) => {
        const requested = Number(item.quantity) || 0;
        return {
            prItemId: item.id,
            item: item.item,
            unit: item.unit ?? "",
            requested,
            ordered: ordered[idx],
            remaining: Math.max(0, requested - ordered[idx]),
        };
    });
    const totalRequested = rows.reduce((s, r) => s + r.requested, 0);
    const totalOrdered = rows.reduce((s, r) => s + Math.min(r.ordered, r.requested), 0);
    return {
        items: rows,
        totalRequested,
        totalOrdered,
        totalRemaining: rows.reduce((s, r) => s + r.remaining, 0),
    };
}
/** Accepted (stock-posted) GRN quantity per PR item, traced GRN line → PO line → PR item. */
function computeReceived(pr, pos, grns) {
    const items = pr.requestedItems ?? [];
    const received = items.map(() => 0);
    const posByNumber = new Map(pos.filter(isPoActive).map((p) => [p.poNumber, p]));
    for (const grn of grns) {
        if (norm(grn.status) !== "completed")
            continue;
        const po = posByNumber.get(grn.poNumber);
        if (!po)
            continue;
        for (const line of grn.items ?? []) {
            const qty = Number(line.acceptedQty) || 0;
            if (qty <= 0)
                continue;
            const poLine = (po.items ?? []).find((l) => line.materialId && norm(l.materialId) === norm(line.materialId)) ??
                (po.items ?? []).find((l) => line.productCode && norm(l.productCode || l.itemCode) === norm(line.productCode));
            const idx = matchPrItemIndex(items, poLine ?? { materialId: line.materialId, productCode: line.productCode, productName: line.productName, quantity: qty });
            if (idx >= 0)
                received[idx] += qty;
        }
    }
    return received;
}
export function derivePrStatus(currentStatus, fulfillment, hasOpenRfq) {
    if (!LIFECYCLE_PR_STATUSES.has(currentStatus))
        return currentStatus;
    if (fulfillment.totalRequested > 0 && fulfillment.totalRemaining === 0)
        return PR_STATUS.CLOSED;
    if (fulfillment.totalOrdered > 0)
        return PR_STATUS.PARTIALLY_ORDERED;
    if (hasOpenRfq)
        return PR_STATUS.IN_SOURCING;
    return PR_STATUS.APPROVED;
}
async function loadPrContext(prNumber) {
    const [pr, pos, rfqs] = await Promise.all([
        requisitions.getRequisitionByNumber(prNumber),
        listRows(T.purchaseOrders, { filters: { linked_pr: prNumber } }),
        listRows(T.rfqs, { filters: { linked_pr: prNumber } }),
    ]);
    return { pr, pos, rfqs };
}
function summarize(pr, pos, rfqs) {
    const fulfillment = computeFulfillment(pr, pos);
    const openRfq = rfqs.find(isRfqOpen) ?? null;
    const derivedStatus = derivePrStatus(pr.status, fulfillment, Boolean(openRfq));
    const canSource = SOURCEABLE_PR_STATUSES.has(derivedStatus) && fulfillment.totalRemaining > 0 && !openRfq;
    return {
        prId: pr.id,
        prNumber: pr.prNumber,
        status: pr.status,
        derivedStatus,
        ...fulfillment,
        openRfq: openRfq
            ? { id: openRfq.id, rfqNumber: openRfq.rfqNumber, status: openRfq.status }
            : null,
        rfqs: rfqs.map((r) => ({ id: r.id, rfqNumber: r.rfqNumber, status: r.status })),
        purchaseOrders: pos.map((p) => ({ id: p.id, poNumber: p.poNumber, status: p.status })),
        canCreateRfq: canSource,
        canCreatePo: canSource,
    };
}
/** Recompute and persist the PR status and per-item ordered / received qty from linked RFQs, POs and GRNs. */
export async function syncPrStatus(prNumber) {
    const key = trimOrEmpty(prNumber);
    if (!key)
        return null;
    const { pr, pos, rfqs } = await loadPrContext(key);
    if (!pr)
        return null;
    const summary = summarize(pr, pos, rfqs);
    if (summary.derivedStatus !== pr.status) {
        await updateRow(T.purchaseRequisitions, pr.id, { status: summary.derivedStatus });
    }
    const grnLists = await Promise.all(pos.map((po) => listRows(T.grns, { filters: { po_number: po.poNumber } })));
    const received = computeReceived(pr, pos, grnLists.flat());
    await requisitions.saveItemProgress(pr.requestedItems, pr.requestedItems.map((item, idx) => ({
        id: item.id,
        orderedQty: summary.items[idx]?.ordered ?? 0,
        receivedQty: received[idx],
    })));
    return summary.derivedStatus;
}
/** GRN stock posted for a PO — roll received qty up to the PR it came from. */
export async function syncPrForPo(poNumber) {
    const key = trimOrEmpty(poNumber);
    if (!key)
        return;
    const rows = await listRows(T.purchaseOrders, { filters: { po_number: key }, limit: 1 });
    await syncPrStatus(rows[0]?.linkedPR);
}
async function assertRfqAllowed(prNumber, excludeRfqId) {
    const { pr, pos, rfqs } = await loadPrContext(prNumber);
    if (!pr)
        throw new NotFoundError(`Purchase requisition ${prNumber} not found`);
    const others = rfqs.filter((r) => r.id !== excludeRfqId);
    const summary = summarize(pr, pos, others);
    if (!SOURCEABLE_PR_STATUSES.has(summary.derivedStatus)) {
        throw new ConflictError(`RFQ can only be raised from an Approved or Partially Ordered PR (${prNumber} is ${summary.derivedStatus}).`);
    }
    if (summary.openRfq) {
        throw new ConflictError(`${prNumber} already has an open RFQ (${summary.openRfq.rfqNumber}).`);
    }
    if (summary.totalRemaining <= 0) {
        throw new ConflictError(`${prNumber} has no remaining quantity to source.`);
    }
}
async function assertPoAllowed(params) {
    const { prNumber, linkedRfq, items, existingPoId, wasLinkedToSamePr } = params;
    const { pr, pos, rfqs } = await loadPrContext(prNumber);
    if (!pr)
        throw new NotFoundError(`Purchase requisition ${prNumber} not found`);
    const allowedStatuses = new Set([
        PR_STATUS.APPROVED,
        PR_STATUS.IN_SOURCING,
        PR_STATUS.PARTIALLY_ORDERED,
        ...(wasLinkedToSamePr ? [PR_STATUS.CLOSED] : []),
    ]);
    if (!allowedStatuses.has(pr.status)) {
        throw new ConflictError(`A PO cannot be raised against ${prNumber} while it is ${pr.status}.`);
    }
    const openRfqs = rfqs.filter(isRfqOpen);
    if (openRfqs.length > 0 && !openRfqs.some((r) => r.rfqNumber === linkedRfq)) {
        throw new ConflictError(`${prNumber} is in sourcing via ${openRfqs[0].rfqNumber}. Convert that RFQ to a PO, or cancel it before ordering directly.`);
    }
    if (items.length === 0)
        throw new ValidationError("Add at least one line item.");
    const fulfillment = computeFulfillment(pr, pos, existingPoId);
    const requestedNow = fulfillment.items.map(() => 0);
    const details = [];
    items.forEach((line, i) => {
        const qty = Number(line.quantity) || 0;
        const label = line.productName || line.itemDescription || line.productCode || `Line ${i + 1}`;
        if (qty <= 0) {
            details.push({ path: `items[${i}].quantity`, message: `${label}: quantity must be greater than 0` });
            return;
        }
        const idx = matchPrItemIndex(pr.requestedItems ?? [], line);
        if (idx < 0) {
            details.push({ path: `items[${i}]`, message: `${label} is not on ${prNumber}` });
            return;
        }
        requestedNow[idx] += qty;
    });
    fulfillment.items.forEach((row, idx) => {
        if (requestedNow[idx] > row.remaining) {
            details.push({
                path: `items.${row.prItemId}`,
                message: `${row.item}: ordering ${requestedNow[idx]} but only ${row.remaining} ${row.unit} remaining on ${prNumber}`,
            });
        }
    });
    if (details.length > 0) {
        throw new ValidationError(details.map((d) => d.message).join("; "), details);
    }
}
// ── RFQ ↔ PO link ────────────────────────────────────────────────────────────
async function loadRfqByNumber(rfqNumber) {
    const rows = await listRows(T.rfqs, { filters: { rfq_number: rfqNumber }, limit: 1 });
    return rows[0] ?? null;
}
function withRfqTimeline(rfq, stage, note) {
    return [
        ...(rfq.activityTimeline ?? []),
        { stage, timestamp: new Date().toISOString().slice(0, 10), note, author: "System" },
    ];
}
/** An RFQ yields at most one live PO: it must have a selected vendor and no PO yet. */
async function assertRfqConvertible(rfqNumber, prNumber, ownPoNumber) {
    const rfq = await loadRfqByNumber(rfqNumber);
    if (!rfq)
        throw new NotFoundError(`RFQ ${rfqNumber} not found`);
    const existingPo = trimOrEmpty(rfq.poNumber);
    if (existingPo && existingPo !== ownPoNumber) {
        throw new ConflictError(`${rfqNumber} is already converted to ${existingPo}.`);
    }
    if (!existingPo && (rfq.status !== RFQ_STATUS.VENDOR_SELECTED || !trimOrEmpty(rfq.selectedVendor))) {
        throw new ConflictError(`Select a winning vendor on ${rfqNumber} before creating a PO.`);
    }
    const rfqPr = trimOrEmpty(rfq.linkedPR);
    if (rfqPr && prNumber && rfqPr !== prNumber) {
        throw new ValidationError(`${rfqNumber} belongs to ${rfqPr}, not ${prNumber}.`);
    }
    return rfq;
}
async function linkRfqToPo(rfq, poNumber) {
    await updateRow(T.rfqs, rfq.id, {
        status: RFQ_STATUS.CONVERTED_TO_PO,
        poNumber,
        activityTimeline: withRfqTimeline(rfq, "Converted to PO", `Purchase order ${poNumber} created`),
    });
}
/** PO cancelled or deleted — reopen the RFQ so a replacement PO can be raised. */
async function releaseRfqFromPo(rfqNumber, poNumber) {
    const rfq = rfqNumber ? await loadRfqByNumber(rfqNumber) : null;
    if (!rfq || trimOrEmpty(rfq.poNumber) !== poNumber)
        return;
    await updateRow(T.rfqs, rfq.id, {
        status: RFQ_STATUS.VENDOR_SELECTED,
        poNumber: null,
        activityTimeline: withRfqTimeline(rfq, "PO Cancelled", `${poNumber} was cancelled — RFQ reopened for a new purchase order`),
    });
}
/** PO fulfilled (Closed) — nothing further is pending on the RFQ. */
async function closeRfqForPo(rfqNumber, poNumber) {
    const rfq = rfqNumber ? await loadRfqByNumber(rfqNumber) : null;
    if (!rfq || trimOrEmpty(rfq.poNumber) !== poNumber)
        return;
    if (rfq.status !== RFQ_STATUS.CONVERTED_TO_PO)
        return;
    await updateRow(T.rfqs, rfq.id, {
        status: RFQ_STATUS.CLOSED,
        activityTimeline: withRfqTimeline(rfq, "Closed", `${poNumber} completed — RFQ closed`),
    });
}
// ── Requisitions ─────────────────────────────────────────────────────────────
const SOURCE_MODULE_SET = new Set(requisitions.SOURCE_MODULES);
function assertSourceModule(value) {
    if (value === undefined)
        return;
    if (!SOURCE_MODULE_SET.has(String(value))) {
        throw new ValidationError(`Unknown source module "${String(value)}".`, [
            { path: "sourceModule", message: `Use one of: ${requisitions.SOURCE_MODULES.join(", ")}` },
        ]);
    }
}
const queryValue = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s && s !== "all" ? s : undefined;
};
/** GET /requisitions?sourceModule=Housekeeping,Kitchen&status=…&department=… */
export async function listRequisitions(req, res) {
    try {
        const modules = queryValue(req.query.sourceModule)
            ?.split(",")
            .map((m) => m.trim())
            .filter(Boolean);
        const rows = await requisitions.listRequisitions({
            status: queryValue(req.query.status),
            department: queryValue(req.query.department),
            sourceModules: modules,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getRequisition(req, res) {
    try {
        const row = await requisitions.getRequisition(String(req.params.id));
        if (!row)
            throw new NotFoundError("Purchase requisition not found");
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createRequisition(req, res) {
    try {
        const body = withPsDocumentDefaults({ ...req.body }, PR_DOC);
        assertSourceModule(body.sourceModule);
        const status = String(body.status ?? PR_STATUS.DRAFT);
        if (status !== PR_STATUS.DRAFT && status !== PR_STATUS.PENDING_APPROVAL) {
            throw new ValidationError("A new requisition is saved as Draft or submitted for approval.");
        }
        body.status = status;
        if (!trimOrEmpty(body.currentApprover))
            body.currentApprover = "Purchase Manager";
        const row = await requisitions.createRequisition(body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listFulfillment(_req, res) {
    try {
        const [prs, pos, rfqs] = await Promise.all([
            requisitions.listRequisitions(),
            listRows(T.purchaseOrders),
            listRows(T.rfqs),
        ]);
        const posByPr = new Map();
        for (const po of pos) {
            const key = trimOrEmpty(po.linkedPR);
            if (key)
                posByPr.set(key, [...(posByPr.get(key) ?? []), po]);
        }
        const rfqsByPr = new Map();
        for (const rfq of rfqs) {
            const key = trimOrEmpty(rfq.linkedPR);
            if (key)
                rfqsByPr.set(key, [...(rfqsByPr.get(key) ?? []), rfq]);
        }
        const data = prs.map((pr) => summarize(pr, posByPr.get(pr.prNumber) ?? [], rfqsByPr.get(pr.prNumber) ?? []));
        return ok(res, data);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getFulfillment(req, res) {
    try {
        const pr = await requisitions.getRequisition(String(req.params.id));
        if (!pr)
            throw new NotFoundError("Purchase requisition not found");
        const { pos, rfqs } = await loadPrContext(pr.prNumber);
        return ok(res, summarize(pr, pos, rfqs));
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Bring stored PR statuses in line with their RFQs / POs (legacy data). */
export async function reconcileStatuses(_req, res) {
    try {
        const [prs, pos, rfqs] = await Promise.all([
            requisitions.listRequisitions(),
            listRows(T.purchaseOrders),
            listRows(T.rfqs),
        ]);
        const updated = [];
        for (const pr of prs) {
            if (!LIFECYCLE_PR_STATUSES.has(pr.status))
                continue;
            const { derivedStatus } = summarize(pr, pos.filter((p) => trimOrEmpty(p.linkedPR) === pr.prNumber), rfqs.filter((r) => trimOrEmpty(r.linkedPR) === pr.prNumber));
            if (derivedStatus !== pr.status) {
                await updateRow(T.purchaseRequisitions, pr.id, { status: derivedStatus });
                updated.push({ prNumber: pr.prNumber, from: pr.status, to: derivedStatus });
            }
        }
        return ok(res, { updated });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateRequisition(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        delete body.prNumber;
        const prev = await requisitions.getRequisition(id);
        if (!prev)
            throw new NotFoundError("Purchase requisition not found");
        assertSourceModule(body.sourceModule);
        const nextStatus = body.status !== undefined ? String(body.status) : prev.status;
        const itemsChanging = body.requestedItems !== undefined;
        if (nextStatus !== prev.status || itemsChanging) {
            if (nextStatus !== prev.status && SYSTEM_PR_STATUSES.has(nextStatus)) {
                throw new ValidationError(`"${nextStatus}" is set automatically from linked RFQs and POs.`);
            }
            const { pos, rfqs } = await loadPrContext(prev.prNumber);
            const hasSourcing = pos.some(isPoActive) || rfqs.some(isRfqOpen);
            if (hasSourcing && itemsChanging) {
                throw new ConflictError(`${prev.prNumber} already has active RFQs or purchase orders, so its items can no longer be edited.`);
            }
            if (hasSourcing && nextStatus !== prev.status && nextStatus !== PR_STATUS.APPROVED) {
                throw new ConflictError(`${prev.prNumber} has active RFQs or purchase orders. Cancel them before changing it to ${nextStatus}.`);
            }
        }
        await requisitions.updateRequisition(id, body, prev);
        await syncPrStatus(prev.prNumber);
        const row = await requisitions.getRequisition(id);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteRequisition(req, res) {
    try {
        const id = String(req.params.id);
        const prev = await getRowById(T.purchaseRequisitions, id);
        if (!prev)
            throw new NotFoundError("Purchase requisition not found");
        const { pos, rfqs } = await loadPrContext(prev.prNumber);
        if (pos.length > 0 || rfqs.length > 0) {
            throw new ConflictError(`${prev.prNumber} is linked to RFQs or purchase orders and cannot be deleted. Cancel it instead.`);
        }
        await requisitions.deleteRequisition(id);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
// ── RFQs ─────────────────────────────────────────────────────────────────────
export async function createRfq(req, res) {
    try {
        const body = withPsDocumentDefaults({ ...req.body }, RFQ_DOC);
        const prNumber = trimOrEmpty(body.linkedPR);
        if (!prNumber)
            throw new ValidationError("Linked purchase requisition is required.");
        body.linkedPR = prNumber;
        await assertRfqAllowed(prNumber);
        if (!body.id)
            body.id = newId("RFQ");
        const row = await insertRow(T.rfqs, body);
        await syncPrStatus(prNumber);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateRfq(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const prev = await getRowById(T.rfqs, id);
        if (!prev)
            throw new NotFoundError("RFQ not found");
        const prevPr = trimOrEmpty(prev.linkedPR);
        const nextPr = body.linkedPR !== undefined ? trimOrEmpty(body.linkedPR) : prevPr;
        const nextStatus = body.status !== undefined ? String(body.status) : prev.status;
        if (body.poNumber !== undefined && trimOrEmpty(body.poNumber) !== trimOrEmpty(prev.poNumber)) {
            throw new ValidationError("The PO reference is set automatically when a PO is created from the RFQ.");
        }
        if (nextStatus !== prev.status) {
            if (prev.status === RFQ_STATUS.CLOSED) {
                throw new ConflictError(`${prev.rfqNumber} is closed and can no longer change.`);
            }
            if (nextStatus === RFQ_STATUS.CONVERTED_TO_PO) {
                throw new ConflictError(`"Converted to PO" is set automatically when a PO is created from ${prev.rfqNumber}.`);
            }
            if (prev.status === RFQ_STATUS.CONVERTED_TO_PO && nextStatus !== RFQ_STATUS.CLOSED) {
                throw new ConflictError(`${prev.rfqNumber} is linked to ${prev.poNumber ?? "a purchase order"}. Cancel that PO to reopen the RFQ.`);
            }
            if (nextStatus === RFQ_STATUS.CLOSED && prev.status !== RFQ_STATUS.CONVERTED_TO_PO) {
                throw new ConflictError(`${prev.rfqNumber} still has a pending PO step. Create its PO first, or cancel the RFQ instead.`);
            }
        }
        const reopening = !isRfqOpen(prev) && isRfqOpen({ ...prev, status: nextStatus });
        if (nextPr && (nextPr !== prevPr || reopening)) {
            await assertRfqAllowed(nextPr, id);
        }
        const row = await updateRow(T.rfqs, id, body);
        await syncPrStatus(prevPr);
        if (nextPr !== prevPr)
            await syncPrStatus(nextPr);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteRfq(req, res) {
    try {
        const id = String(req.params.id);
        const prev = await getRowById(T.rfqs, id);
        if (!prev)
            throw new NotFoundError("RFQ not found");
        await deleteRow(T.rfqs, id);
        await syncPrStatus(prev.linkedPR);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
// ── Purchase orders ──────────────────────────────────────────────────────────
export async function createPurchaseOrder(req, res) {
    try {
        const body = withPsDocumentDefaults({ ...req.body }, PO_DOC);
        const active = norm(body.status) !== "cancelled";
        const linkedRfq = trimOrEmpty(body.linkedRFQ);
        let prNumber = trimOrEmpty(body.linkedPR);
        const rfq = linkedRfq && active ? await assertRfqConvertible(linkedRfq, prNumber) : null;
        if (rfq && !prNumber && trimOrEmpty(rfq.linkedPR)) {
            prNumber = trimOrEmpty(rfq.linkedPR);
            body.linkedPR = prNumber;
        }
        if (prNumber && active) {
            await assertPoAllowed({
                prNumber,
                linkedRfq,
                items: body.items ?? [],
                wasLinkedToSamePr: false,
            });
        }
        if (!body.id)
            body.id = newId("PO");
        const row = await insertRow(T.purchaseOrders, body);
        if (rfq)
            await linkRfqToPo(rfq, row.poNumber);
        await syncPrStatus(prNumber);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updatePurchaseOrder(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const prev = await getRowById(T.purchaseOrders, id);
        if (!prev)
            throw new NotFoundError("Purchase order not found");
        const prevPr = trimOrEmpty(prev.linkedPR);
        const nextPr = body.linkedPR !== undefined ? trimOrEmpty(body.linkedPR) : prevPr;
        const nextStatus = body.status !== undefined ? String(body.status) : prev.status;
        const willBeActive = norm(nextStatus) !== "cancelled";
        const reopening = !isPoActive(prev) && willBeActive;
        const linesChanged = body.items !== undefined || body.linkedPR !== undefined || body.linkedRFQ !== undefined;
        const prevRfq = trimOrEmpty(prev.linkedRFQ);
        const nextRfq = body.linkedRFQ !== undefined ? trimOrEmpty(body.linkedRFQ) : prevRfq;
        const linkingRfq = Boolean(nextRfq) && willBeActive && (nextRfq !== prevRfq || reopening);
        const rfq = linkingRfq ? await assertRfqConvertible(nextRfq, nextPr, prev.poNumber) : null;
        if (nextPr && willBeActive && (linesChanged || reopening)) {
            await assertPoAllowed({
                prNumber: nextPr,
                linkedRfq: nextRfq,
                items: body.items ?? prev.items ?? [],
                existingPoId: id,
                wasLinkedToSamePr: nextPr === prevPr,
            });
        }
        const row = await updateRow(T.purchaseOrders, id, body);
        const poNumber = row.poNumber || prev.poNumber;
        if (prevRfq && (prevRfq !== nextRfq || (isPoActive(prev) && !willBeActive))) {
            await releaseRfqFromPo(prevRfq, prev.poNumber);
        }
        if (rfq)
            await linkRfqToPo(rfq, poNumber);
        if (nextRfq && norm(nextStatus) === "closed" && norm(prev.status) !== "closed") {
            await closeRfqForPo(nextRfq, poNumber);
        }
        await syncPrStatus(prevPr);
        if (nextPr !== prevPr)
            await syncPrStatus(nextPr);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deletePurchaseOrder(req, res) {
    try {
        const id = String(req.params.id);
        const prev = await getRowById(T.purchaseOrders, id);
        if (!prev)
            throw new NotFoundError("Purchase order not found");
        await deleteRow(T.purchaseOrders, id);
        if (trimOrEmpty(prev.linkedRFQ))
            await releaseRfqFromPo(trimOrEmpty(prev.linkedRFQ), prev.poNumber);
        await syncPrStatus(prev.linkedPR);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=requisition-lifecycle.js.map
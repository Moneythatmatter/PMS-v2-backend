import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { AppError } from "../../errors/index.js";
import { isLaundryFolioCharge, settleLaundryCounter, settleLaundryFolioViaRpc, } from "../../services/housekeeping/laundry-settle.service.js";
const LAUNDRY_FLOW = [
    "Collection",
    "Washing",
    "Ironing",
    "Ready",
    "Delivered",
];
/** Fields that may be missing until hk-laundry-jobs-billing-columns.sql is applied. */
const EXTENDED_KEYS = [
    "guestPhone",
    "folioId",
    "bookingId",
    "guestId",
    "urgency",
    "serviceType",
    "expectedAt",
    "subtotal",
    "taxAmount",
    "billingStatus",
    "paymentMode",
    "paidAt",
    "cancelled",
    "isOutsourced",
    "lineItems",
];
function sanitizeJobBody(body) {
    const out = { ...body };
    if (typeof out.guestName === "string")
        out.guestName = out.guestName.trim();
    if (typeof out.room === "string")
        out.room = out.room.trim();
    if (typeof out.item === "string")
        out.item = out.item.trim();
    if (out.charges != null)
        out.charges = Number(out.charges) || 0;
    if (out.subtotal != null)
        out.subtotal = Number(out.subtotal) || 0;
    if (out.taxAmount != null)
        out.taxAmount = Number(out.taxAmount) || 0;
    if (out.quantity != null)
        out.quantity = Number(out.quantity) || 1;
    if (!Array.isArray(out.lineItems) && out.lineItems == null) {
        out.lineItems = [];
    }
    return out;
}
/** Mirror extended fields into timeline so inserts survive if billing columns are absent. */
function packExtendedIntoTimeline(job) {
    const timeline = {
        ...(job.timeline ?? {}),
    };
    const ext = {
        ...(timeline.ext ?? {}),
    };
    for (const key of EXTENDED_KEYS) {
        if (job[key] !== undefined)
            ext[key] = job[key];
    }
    timeline.ext = ext;
    return { ...job, timeline };
}
function hydrateFromTimeline(job) {
    if (!job)
        return job;
    const timeline = job.timeline ?? {};
    const ext = timeline.ext ?? {};
    const out = { ...job };
    for (const key of EXTENDED_KEYS) {
        if (out[key] === undefined || out[key] === null) {
            if (ext[key] !== undefined)
                out[key] = ext[key];
        }
    }
    // Defaults when neither column nor timeline has them
    if (out.billingStatus == null)
        out.billingStatus = "Unbilled";
    if (out.cancelled == null)
        out.cancelled = false;
    if (!Array.isArray(out.lineItems))
        out.lineItems = [];
    return out;
}
export async function listLaundry(req, res) {
    try {
        const status = req.query.status;
        const type = req.query.type;
        const billingStatus = req.query.billingStatus;
        const filters = {};
        if (status)
            filters.status = status;
        if (type)
            filters.type = type;
        // Only filter in DB when column exists; otherwise filter after hydrate
        let rows;
        try {
            if (billingStatus)
                filters.billing_status = billingStatus;
            rows = await hkModel.list(hkModel.tables.laundryJobs, {
                filters,
                orderBy: "id",
                ascending: false,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/billing_status|schema cache/i.test(msg))
                throw err;
            const { billing_status: _drop, ...baseFilters } = filters;
            rows = await hkModel.list(hkModel.tables.laundryJobs, {
                filters: baseFilters,
                orderBy: "id",
                ascending: false,
            });
        }
        const hydrated = rows.map((r) => hydrateFromTimeline(r));
        const filtered = billingStatus
            ? hydrated.filter((r) => String(r.billingStatus ?? "Unbilled") === billingStatus)
            : hydrated;
        return ok(res, filtered);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getLaundry(req, res) {
    try {
        const row = await hkModel.get(hkModel.tables.laundryJobs, String(req.params.id));
        if (!row)
            return fail(res, "Laundry job not found", 404);
        return ok(res, hydrateFromTimeline(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createLaundry(req, res) {
    try {
        let body = sanitizeJobBody({ ...req.body });
        const type = String(body.type ?? "Guest");
        if (!body.id) {
            body.id = hkModel.newId(type === "Guest" ? "LND" : "LD");
        }
        if (!body.status)
            body.status = "Collection";
        if (!body.billingStatus)
            body.billingStatus = "Unbilled";
        if (body.cancelled === undefined)
            body.cancelled = false;
        if (!body.timeline) {
            body.timeline = {
                collectedAt: new Date().toISOString(),
            };
        }
        if (!body.createdAt)
            body.createdAt = new Date().toISOString();
        body = packExtendedIntoTimeline(body);
        const row = await hkModel.create(hkModel.tables.laundryJobs, body);
        return ok(res, hydrateFromTimeline(row), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateLaundry(req, res) {
    try {
        const id = String(req.params.id);
        const existing = hydrateFromTimeline((await hkModel.get(hkModel.tables.laundryJobs, id)));
        if (!existing)
            return fail(res, "Laundry job not found", 404);
        let body = sanitizeJobBody({ ...req.body });
        delete body.id;
        // Don't allow settlement fields via generic update — use /settle
        delete body.billingStatus;
        delete body.paymentMode;
        delete body.paidAt;
        // Preserve existing timeline stamps + merge new ext
        body.timeline = {
            ...(existing.timeline ?? {}),
            ...(body.timeline ?? {}),
        };
        body = packExtendedIntoTimeline({ ...existing, ...body });
        const row = await hkModel.update(hkModel.tables.laundryJobs, id, body);
        return ok(res, hydrateFromTimeline(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteLaundry(req, res) {
    try {
        await hkModel.remove(hkModel.tables.laundryJobs, String(req.params.id));
        return ok(res, { id: req.params.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function advanceLaundry(req, res) {
    try {
        const id = String(req.params.id);
        const existing = hydrateFromTimeline((await hkModel.get(hkModel.tables.laundryJobs, id)));
        if (!existing)
            return fail(res, "Laundry job not found", 404);
        if (existing.cancelled) {
            return fail(res, "Cannot advance a cancelled laundry job", 400);
        }
        const current = String(existing.status);
        const idx = LAUNDRY_FLOW.indexOf(current);
        if (idx < 0 || idx >= LAUNDRY_FLOW.length - 1) {
            return fail(res, `Cannot advance from status ${current}`);
        }
        const next = LAUNDRY_FLOW[idx + 1];
        const timeline = {
            ...(existing.timeline ?? {}),
        };
        const stamp = new Date().toISOString();
        if (next === "Washing")
            timeline.washedAt = stamp;
        if (next === "Ironing" && !timeline.washedAt)
            timeline.washedAt = stamp;
        if (next === "Ready")
            timeline.readyAt = stamp;
        if (next === "Delivered")
            timeline.deliveredAt = stamp;
        const row = await hkModel.update(hkModel.tables.laundryJobs, id, {
            status: next,
            timeline,
        });
        return ok(res, hydrateFromTimeline(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
/**
 * Settle delivered guest laundry:
 * - Cash / Card / UPI → counter payment (billingStatus = Settled)
 * - Room Charge → post to guest folio + reservations.laundry (billingStatus = Folio)
 */
export async function settleLaundry(req, res) {
    try {
        const id = String(req.params.id);
        const existing = hydrateFromTimeline((await hkModel.get(hkModel.tables.laundryJobs, id)));
        if (!existing)
            return fail(res, "Laundry job not found", 404);
        if (existing.cancelled) {
            return fail(res, "Cannot settle a cancelled laundry job", 400);
        }
        if (String(existing.status) !== "Delivered") {
            return fail(res, "Laundry must be Delivered before settlement", 400);
        }
        const billing = String(existing.billingStatus ?? "Unbilled");
        if (billing !== "Unbilled") {
            return fail(res, `Laundry job is already ${billing}`, 400);
        }
        if (String(existing.type ?? "Guest") !== "Guest") {
            return fail(res, "Settlement is only for guest laundry", 400);
        }
        const paymentMode = String(req.body?.paymentMode ??
            req.body?.paymentMethod ??
            "Cash");
        const amount = Number(req.body?.amount ?? existing.charges ?? 0);
        if (!(amount > 0)) {
            return fail(res, "Settlement amount must be > 0", 400);
        }
        const bookingId = String(existing.bookingId ??
            req.body?.bookingId ??
            "").trim();
        const guestId = existing.guestId ??
            (req.body?.guestId ?? null);
        if (isLaundryFolioCharge(paymentMode)) {
            if (!bookingId) {
                return fail(res, "Room Charge / Folio settle requires a linked in-house booking", 400);
            }
            await settleLaundryFolioViaRpc({
                jobId: id,
                bookingId,
                guestId,
                amount,
                notes: `[LAUNDRY] charge — job ${id} · room ${existing.room ?? "—"}`,
                job: existing,
            });
        }
        else {
            await settleLaundryCounter({
                jobId: id,
                amount,
                paymentMethod: paymentMode,
                bookingId: bookingId || null,
                guestId,
                receivedBy: req.body?.receivedBy ?? null,
                externalReference: req.body?.externalReference ??
                    null,
            });
            const paidAt = new Date().toISOString();
            const packed = packExtendedIntoTimeline({
                ...existing,
                billingStatus: "Settled",
                paymentMode,
                paidAt,
            });
            await hkModel.update(hkModel.tables.laundryJobs, id, {
                billingStatus: "Settled",
                paymentMode,
                paidAt,
                timeline: packed.timeline,
            });
        }
        const row = await hkModel.get(hkModel.tables.laundryJobs, id);
        return ok(res, hydrateFromTimeline(row));
    }
    catch (e) {
        if (e instanceof AppError)
            return fail(res, e.message, e.status);
        return fromError(res, e);
    }
}
//# sourceMappingURL=laundry.js.map
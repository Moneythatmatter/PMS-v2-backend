import type { Request, Response } from "express";
import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { AppError } from "../../errors/index.js";
import {
  isLaundryFolioCharge,
  settleLaundryCounter,
  settleLaundryFolioViaRpc,
} from "../../services/housekeeping/laundry-settle.service.js";

type Job = Record<string, unknown>;

const LAUNDRY_FLOW = [
  "Collection",
  "Washing",
  "Ironing",
  "Ready",
  "Delivered",
] as const;

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
] as const;

function sanitizeJobBody(body: Record<string, unknown>): Job {
  const out: Job = { ...body };
  if (typeof out.guestName === "string") out.guestName = out.guestName.trim();
  if (typeof out.room === "string") out.room = out.room.trim();
  if (typeof out.item === "string") out.item = out.item.trim();
  if (out.charges != null) out.charges = Number(out.charges) || 0;
  if (out.subtotal != null) out.subtotal = Number(out.subtotal) || 0;
  if (out.taxAmount != null) out.taxAmount = Number(out.taxAmount) || 0;
  if (out.quantity != null) out.quantity = Number(out.quantity) || 1;
  if (!Array.isArray(out.lineItems) && out.lineItems == null) {
    out.lineItems = [];
  }
  return out;
}

/** Mirror extended fields into timeline so inserts survive if billing columns are absent. */
function packExtendedIntoTimeline(job: Job): Job {
  const timeline = {
    ...((job.timeline as Record<string, unknown>) ?? {}),
  };
  const ext: Record<string, unknown> = {
    ...((timeline.ext as Record<string, unknown>) ?? {}),
  };
  for (const key of EXTENDED_KEYS) {
    if (job[key] !== undefined) ext[key] = job[key];
  }
  timeline.ext = ext;
  return { ...job, timeline };
}

function hydrateFromTimeline(job: Job | null): Job | null {
  if (!job) return job;
  const timeline = (job.timeline as Record<string, unknown>) ?? {};
  const ext = (timeline.ext as Record<string, unknown>) ?? {};
  const out: Job = { ...job };
  for (const key of EXTENDED_KEYS) {
    if (out[key] === undefined || out[key] === null) {
      if (ext[key] !== undefined) out[key] = ext[key];
    }
  }
  // Defaults when neither column nor timeline has them
  if (out.billingStatus == null) out.billingStatus = "Unbilled";
  if (out.cancelled == null) out.cancelled = false;
  if (!Array.isArray(out.lineItems)) out.lineItems = [];
  return out;
}

export async function listLaundry(req: Request, res: Response) {
  try {
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const billingStatus = req.query.billingStatus as string | undefined;
    const filters: Record<string, string | boolean | undefined> = {};
    if (status) filters.status = status;
    if (type) filters.type = type;
    // Only filter in DB when column exists; otherwise filter after hydrate
    let rows: Job[];
    try {
      if (billingStatus) filters.billing_status = billingStatus;
      rows = await hkModel.list<Job>(hkModel.tables.laundryJobs, {
        filters,
        orderBy: "id",
        ascending: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/billing_status|schema cache/i.test(msg)) throw err;
      const { billing_status: _drop, ...baseFilters } = filters;
      rows = await hkModel.list<Job>(hkModel.tables.laundryJobs, {
        filters: baseFilters,
        orderBy: "id",
        ascending: false,
      });
    }
    const hydrated = rows.map((r) => hydrateFromTimeline(r)!);
    const filtered = billingStatus
      ? hydrated.filter(
          (r) => String(r.billingStatus ?? "Unbilled") === billingStatus,
        )
      : hydrated;
    return ok(res, filtered);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLaundry(req: Request, res: Response) {
  try {
    const row = await hkModel.get(
      hkModel.tables.laundryJobs,
      String(req.params.id),
    );
    if (!row) return fail(res, "Laundry job not found", 404);
    return ok(res, hydrateFromTimeline(row as Job));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createLaundry(req: Request, res: Response) {
  try {
    let body = sanitizeJobBody({ ...(req.body as Record<string, unknown>) });
    const type = String(body.type ?? "Guest");
    if (!body.id) {
      body.id = hkModel.newId(type === "Guest" ? "LND" : "LD");
    }
    if (!body.status) body.status = "Collection";
    if (!body.billingStatus) body.billingStatus = "Unbilled";
    if (body.cancelled === undefined) body.cancelled = false;
    if (!body.timeline) {
      body.timeline = {
        collectedAt: new Date().toISOString(),
      };
    }
    if (!body.createdAt) body.createdAt = new Date().toISOString();

    body = packExtendedIntoTimeline(body);
    const row = await hkModel.create(hkModel.tables.laundryJobs, body);
    return ok(res, hydrateFromTimeline(row as Job), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateLaundry(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = hydrateFromTimeline(
      (await hkModel.get<Job>(hkModel.tables.laundryJobs, id)) as Job | null,
    );
    if (!existing) return fail(res, "Laundry job not found", 404);

    let body = sanitizeJobBody({ ...(req.body as Record<string, unknown>) });
    delete body.id;
    // Don't allow settlement fields via generic update — use /settle
    delete body.billingStatus;
    delete body.paymentMode;
    delete body.paidAt;

    // Preserve existing timeline stamps + merge new ext
    body.timeline = {
      ...((existing.timeline as Record<string, unknown>) ?? {}),
      ...((body.timeline as Record<string, unknown>) ?? {}),
    };
    body = packExtendedIntoTimeline({ ...existing, ...body });

    const row = await hkModel.update(hkModel.tables.laundryJobs, id, body);
    return ok(res, hydrateFromTimeline(row as Job));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteLaundry(req: Request, res: Response) {
  try {
    await hkModel.remove(hkModel.tables.laundryJobs, String(req.params.id));
    return ok(res, { id: req.params.id });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function advanceLaundry(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = hydrateFromTimeline(
      (await hkModel.get<Job>(hkModel.tables.laundryJobs, id)) as Job | null,
    );
    if (!existing) return fail(res, "Laundry job not found", 404);
    if (existing.cancelled) {
      return fail(res, "Cannot advance a cancelled laundry job", 400);
    }

    const current = String(existing.status);
    const idx = LAUNDRY_FLOW.indexOf(current as (typeof LAUNDRY_FLOW)[number]);
    if (idx < 0 || idx >= LAUNDRY_FLOW.length - 1) {
      return fail(res, `Cannot advance from status ${current}`);
    }

    const next = LAUNDRY_FLOW[idx + 1];
    const timeline = {
      ...((existing.timeline as Record<string, unknown>) ?? {}),
    };
    const stamp = new Date().toISOString();
    if (next === "Washing") timeline.washedAt = stamp;
    if (next === "Ironing" && !timeline.washedAt) timeline.washedAt = stamp;
    if (next === "Ready") timeline.readyAt = stamp;
    if (next === "Delivered") timeline.deliveredAt = stamp;

    const row = await hkModel.update(hkModel.tables.laundryJobs, id, {
      status: next,
      timeline,
    });
    return ok(res, hydrateFromTimeline(row as Job));
  } catch (e) {
    return fromError(res, e);
  }
}

/**
 * Settle delivered guest laundry:
 * - Cash / Card / UPI → counter payment (billingStatus = Settled)
 * - Room Charge → post to guest folio + reservations.laundry (billingStatus = Folio)
 */
export async function settleLaundry(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const existing = hydrateFromTimeline(
      (await hkModel.get<Job>(hkModel.tables.laundryJobs, id)) as Job | null,
    );
    if (!existing) return fail(res, "Laundry job not found", 404);

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

    const paymentMode = String(
      (req.body as { paymentMode?: string })?.paymentMode ??
        (req.body as { paymentMethod?: string })?.paymentMethod ??
        "Cash",
    );
    const amount = Number(
      (req.body as { amount?: number })?.amount ?? existing.charges ?? 0,
    );
    if (!(amount > 0)) {
      return fail(res, "Settlement amount must be > 0", 400);
    }

    const bookingId = String(
      existing.bookingId ??
        (req.body as { bookingId?: string })?.bookingId ??
        "",
    ).trim();
    const guestId =
      (existing.guestId as string | undefined) ??
      ((req.body as { guestId?: string })?.guestId ?? null);

    if (isLaundryFolioCharge(paymentMode)) {
      if (!bookingId) {
        return fail(
          res,
          "Room Charge / Folio settle requires a linked in-house booking",
          400,
        );
      }
      await settleLaundryFolioViaRpc({
        jobId: id,
        bookingId,
        guestId,
        amount,
        notes: `[LAUNDRY] charge — job ${id} · room ${existing.room ?? "—"}`,
        job: existing,
      });
    } else {
      await settleLaundryCounter({
        jobId: id,
        amount,
        paymentMethod: paymentMode,
        bookingId: bookingId || null,
        guestId,
        receivedBy: (req.body as { receivedBy?: string })?.receivedBy ?? null,
        externalReference:
          (req.body as { externalReference?: string })?.externalReference ??
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
    return ok(res, hydrateFromTimeline(row as Job));
  } catch (e) {
    if (e instanceof AppError) return fail(res, e.message, e.status);
    return fromError(res, e);
  }
}

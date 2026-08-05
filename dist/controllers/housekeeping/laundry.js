import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
const LAUNDRY_FLOW = [
    "Collection",
    "Washing",
    "Ironing",
    "Ready",
    "Delivered",
];
export async function listLaundry(req, res) {
    try {
        const status = req.query.status;
        const type = req.query.type;
        const rows = await hkModel.list(hkModel.tables.laundryJobs, {
            filters: { status, type },
            orderBy: "id",
            ascending: false,
        });
        return ok(res, rows);
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
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createLaundry(req, res) {
    try {
        const body = { ...req.body };
        if (!body.id)
            body.id = hkModel.newId("LD");
        if (!body.status)
            body.status = "Collection";
        if (!body.timeline) {
            body.timeline = {
                collectedAt: new Date().toISOString(),
            };
        }
        const row = await hkModel.create(hkModel.tables.laundryJobs, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateLaundry(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const row = await hkModel.update(hkModel.tables.laundryJobs, id, body);
        return ok(res, row);
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
        const existing = await hkModel.get(hkModel.tables.laundryJobs, id);
        if (!existing)
            return fail(res, "Laundry job not found", 404);
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
        if (next === "Ready")
            timeline.readyAt = stamp;
        if (next === "Delivered")
            timeline.deliveredAt = stamp;
        const row = await hkModel.update(hkModel.tables.laundryJobs, id, {
            status: next,
            timeline,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=laundry.js.map
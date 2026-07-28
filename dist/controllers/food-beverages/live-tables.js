import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listLiveTables(req, res) {
    try {
        const outletId = req.query.outletId;
        const rows = await fbModel.list(fbModel.tables.liveTables, {
            filters: outletId ? { outlet_id: outletId } : undefined,
            orderBy: "table_no",
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateLiveTable(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const row = await fbModel.update(fbModel.tables.liveTables, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function seatTable(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.liveTables, id);
        if (!existing)
            return fail(res, "Table not found", 404);
        const body = (req.body ?? {});
        const row = await fbModel.update(fbModel.tables.liveTables, id, {
            status: "Occupied",
            guest: body.guest ?? "Walk-in",
            server: body.server ?? existing.server ?? "—",
            covers: body.covers ?? existing.capacity ?? 2,
            durationMin: 0,
            checkAmount: body.checkAmount ?? 0,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function settleTable(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.liveTables, id);
        if (!existing)
            return fail(res, "Table not found", 404);
        const row = await fbModel.update(fbModel.tables.liveTables, id, {
            status: "Dirty",
            guest: "—",
            server: "—",
            covers: 0,
            durationMin: 0,
            checkAmount: 0,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function cleanTable(req, res) {
    try {
        const id = String(req.params.id);
        const row = await fbModel.update(fbModel.tables.liveTables, id, {
            status: "Available",
            guest: "—",
            server: "—",
            covers: 0,
            durationMin: 0,
            checkAmount: 0,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=live-tables.js.map
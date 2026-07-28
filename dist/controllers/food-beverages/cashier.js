import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listShifts(req, res) {
    try {
        const outletId = req.query.outletId;
        const rows = await fbModel.list(fbModel.tables.cashierShifts, {
            filters: outletId ? { outlet_id: outletId } : undefined,
            orderBy: "id",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function openShift(req, res) {
    try {
        const body = { ...req.body };
        if (!body.id)
            body.id = fbModel.newId("C");
        if (!body.status)
            body.status = "Open";
        if (!body.openedAt) {
            body.openedAt = new Date().toLocaleTimeString("en-IN", {
                hour: "numeric",
                minute: "2-digit",
            });
        }
        body.declaredCash = body.declaredCash ?? null;
        const row = await fbModel.create(fbModel.tables.cashierShifts, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function closeShift(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.cashierShifts, id);
        if (!existing)
            return fail(res, "Shift not found", 404);
        const declaredCash = Number(req.body?.declaredCash ?? 0);
        const row = await fbModel.update(fbModel.tables.cashierShifts, id, {
            declaredCash,
            status: "Closed",
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateShift(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const row = await fbModel.update(fbModel.tables.cashierShifts, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=cashier.js.map
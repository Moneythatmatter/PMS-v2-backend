import { fbModel, mapKdsIncoming, mapKdsOutgoing, } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
const KDS_FLOW = ["Pending", "Preparing", "Ready", "Bumped"];
export async function listKds(req, res) {
    try {
        const outletId = req.query.outletId;
        const includeBumped = req.query.includeBumped === "true";
        let rows = await fbModel.list(fbModel.tables.kdsTickets, {
            filters: outletId ? { outlet_id: outletId } : undefined,
            orderBy: "id",
        });
        if (!includeBumped) {
            rows = rows.filter((r) => r.status !== "Bumped");
        }
        return ok(res, rows.map(mapKdsOutgoing));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createKds(req, res) {
    try {
        let body = mapKdsIncoming({ ...req.body });
        if (!body.id)
            body.id = fbModel.newId("K");
        if (!body.ticket)
            body.ticket = fbModel.newCode("KDS");
        if (!body.status)
            body.status = "Pending";
        if (!Array.isArray(body.lines))
            body.lines = [];
        const row = await fbModel.create(fbModel.tables.kdsTickets, body);
        return ok(res, mapKdsOutgoing(row), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateKds(req, res) {
    try {
        const id = String(req.params.id);
        let body = mapKdsIncoming({ ...req.body });
        delete body.id;
        const row = await fbModel.update(fbModel.tables.kdsTickets, id, body);
        return ok(res, mapKdsOutgoing(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function advanceKds(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.kdsTickets, id);
        if (!existing)
            return fail(res, "Ticket not found", 404);
        const current = String(existing.status);
        const idx = KDS_FLOW.indexOf(current);
        if (idx < 0 || idx >= KDS_FLOW.length - 1) {
            return fail(res, `Cannot advance from status ${current}`);
        }
        const row = await fbModel.update(fbModel.tables.kdsTickets, id, {
            status: KDS_FLOW[idx + 1],
        });
        return ok(res, mapKdsOutgoing(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=kds.js.map
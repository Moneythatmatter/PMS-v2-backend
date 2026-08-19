import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listRequisitions(req, res) {
    try {
        const status = req.query.status;
        const rows = await hkModel.list(hkModel.tables.requisitions, {
            filters: { status },
            orderBy: "id",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getRequisition(req, res) {
    try {
        const row = await hkModel.get(hkModel.tables.requisitions, String(req.params.id));
        if (!row)
            return fail(res, "Requisition not found", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createRequisition(req, res) {
    try {
        const body = { ...req.body };
        if (!body.id)
            body.id = hkModel.newId("RQ");
        if (!body.requestNo)
            body.requestNo = hkModel.newCode("REQ");
        if (!body.status)
            body.status = "Pending";
        if (!body.requestedAt)
            body.requestedAt = new Date().toISOString();
        if (!Array.isArray(body.items))
            body.items = [];
        const row = await hkModel.create(hkModel.tables.requisitions, body);
        return ok(res, row, 201);
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
        const row = await hkModel.update(hkModel.tables.requisitions, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteRequisition(req, res) {
    try {
        await hkModel.remove(hkModel.tables.requisitions, String(req.params.id));
        return ok(res, { id: req.params.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function approveRequisition(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.requisitions, id);
        if (!existing)
            return fail(res, "Requisition not found", 404);
        if (String(existing.status) !== "Pending") {
            return fail(res, `Cannot approve from status ${existing.status}`);
        }
        const row = await hkModel.update(hkModel.tables.requisitions, id, {
            status: "Approved",
            remarks: req.body?.remarks ?? existing.remarks,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function issueRequisition(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.requisitions, id);
        if (!existing)
            return fail(res, "Requisition not found", 404);
        if (!["Pending", "Approved"].includes(String(existing.status))) {
            return fail(res, `Cannot issue from status ${existing.status}`);
        }
        const row = await hkModel.update(hkModel.tables.requisitions, id, {
            status: "Issued",
            issuedAt: new Date().toISOString(),
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function rejectRequisition(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.requisitions, id);
        if (!existing)
            return fail(res, "Requisition not found", 404);
        const row = await hkModel.update(hkModel.tables.requisitions, id, {
            status: "Rejected",
            remarks: req.body?.remarks ?? existing.remarks,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=requisitions.js.map
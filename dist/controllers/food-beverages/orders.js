import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
/** Happy-path kitchen → billing flow (Rejected is terminal / separate). */
const ORDER_FLOW = ["Pending", "Preparing", "Ready", "Served", "Settled"];
function nowLabel() {
    return new Date().toLocaleTimeString("en-IN", {
        hour: "numeric",
        minute: "2-digit",
    });
}
export async function listOrders(req, res) {
    try {
        const outletId = req.query.outletId;
        const status = req.query.status;
        const filters = {
            outlet_id: outletId,
            status,
        };
        const rows = await fbModel.list(fbModel.tables.orders, {
            filters,
            orderBy: "id",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getOrder(req, res) {
    try {
        const row = await fbModel.get(fbModel.tables.orders, String(req.params.id));
        if (!row)
            return fail(res, "Order not found", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createOrder(req, res) {
    try {
        const body = { ...req.body };
        if (!body.id)
            body.id = fbModel.newId("OR");
        if (!body.orderNo)
            body.orderNo = fbModel.newCode("ORD");
        if (!body.status)
            body.status = "Pending";
        if (!body.placedAt)
            body.placedAt = nowLabel();
        if (!Array.isArray(body.lines))
            body.lines = [];
        const row = await fbModel.create(fbModel.tables.orders, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateOrder(req, res) {
    try {
        const id = String(req.params.id);
        const body = { ...req.body };
        delete body.id;
        const row = await fbModel.update(fbModel.tables.orders, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteOrder(req, res) {
    try {
        await fbModel.remove(fbModel.tables.orders, String(req.params.id));
        return ok(res, { id: req.params.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function advanceOrder(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.orders, id);
        if (!existing)
            return fail(res, "Order not found", 404);
        const current = String(existing.status);
        if (current === "Rejected") {
            return fail(res, "Rejected orders cannot be advanced");
        }
        if (current === "Served") {
            return fail(res, "Served orders must be settled in POS Billing (collect payment)", 400);
        }
        // Kitchen owns Pending→Preparing (accept) and Preparing→Ready
        // Service owns Ready→Served; Settled only via /pay
        const idx = ORDER_FLOW.indexOf(current);
        if (idx < 0 || idx >= ORDER_FLOW.length - 1) {
            return fail(res, `Cannot advance from status ${current}`);
        }
        const next = ORDER_FLOW[idx + 1];
        if (next === "Settled") {
            return fail(res, "Use POS Billing to settle the bill", 400);
        }
        const row = await fbModel.update(fbModel.tables.orders, id, { status: next });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Kitchen accepts a pending order → Preparing (+ optional prep ETA minutes). */
export async function acceptOrder(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.orders, id);
        if (!existing)
            return fail(res, "Order not found", 404);
        if (String(existing.status) !== "Pending") {
            return fail(res, "Only pending orders can be accepted", 400);
        }
        const body = (req.body ?? {});
        const prepRaw = body.prepMinutes ?? body.prep_minutes;
        const prepMinutes = prepRaw === undefined || prepRaw === null || prepRaw === ""
            ? null
            : Number(prepRaw);
        if (prepMinutes != null && (!Number.isFinite(prepMinutes) || prepMinutes < 0)) {
            return fail(res, "prepMinutes must be a non-negative number", 400);
        }
        const patch = {
            status: "Preparing",
            rejectReason: null,
        };
        if (prepMinutes != null)
            patch.prepMinutes = Math.round(prepMinutes);
        const row = await fbModel.update(fbModel.tables.orders, id, patch);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** Kitchen rejects a pending order with a reason. */
export async function rejectOrder(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.orders, id);
        if (!existing)
            return fail(res, "Order not found", 404);
        if (String(existing.status) !== "Pending") {
            return fail(res, "Only pending orders can be rejected", 400);
        }
        const body = (req.body ?? {});
        const reason = String(body.reason ?? body.rejectReason ?? "").trim();
        if (!reason)
            return fail(res, "Rejection reason is required", 400);
        const row = await fbModel.update(fbModel.tables.orders, id, {
            status: "Rejected",
            rejectReason: reason,
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
/** POS collects payment on a Served order → Settled. */
export async function payOrder(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await fbModel.get(fbModel.tables.orders, id);
        if (!existing)
            return fail(res, "Order not found", 404);
        const status = String(existing.status);
        if (status !== "Served") {
            return fail(res, "Only Served orders can be paid. Mark Served on Orders first.", 400);
        }
        const body = (req.body ?? {});
        const paymentMode = String(body.paymentMode ?? body.mode ?? "Cash").trim() || "Cash";
        const row = await fbModel.update(fbModel.tables.orders, id, {
            status: "Settled",
            paymentMode,
            paidAt: nowLabel(),
        });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=orders.js.map
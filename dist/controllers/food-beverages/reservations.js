import { TableReservationService } from "../../services/food-beverages/table-reservations.service.js";
import { fromError, ok } from "../../utils/response.js";
const param = (req, key) => String(req.params[key] ?? "");
const query = (req, key) => {
    const v = req.query[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const body = (req) => (req.body ?? {});
export async function list(req, res) {
    try {
        const rows = await TableReservationService.list({
            date: query(req, "date"),
            outletId: query(req, "outletId") ?? query(req, "outlet_id"),
            status: query(req, "status"),
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function get(req, res) {
    try {
        return ok(res, await TableReservationService.get(param(req, "id")));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function create(req, res) {
    try {
        return ok(res, await TableReservationService.create(body(req)), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function update(req, res) {
    try {
        return ok(res, await TableReservationService.update(param(req, "id"), body(req)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function remove(req, res) {
    try {
        await TableReservationService.remove(param(req, "id"));
        return ok(res, { id: param(req, "id") });
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function seat(req, res) {
    try {
        const b = body(req);
        const result = await TableReservationService.seat(param(req, "id"), {
            tableNo: b.tableNo ? String(b.tableNo) : undefined,
            server: b.server ? String(b.server) : undefined,
            override: b.override === true,
        });
        return ok(res, result);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function markNoShow(req, res) {
    try {
        return ok(res, await TableReservationService.markNoShow(param(req, "id")));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function cancel(req, res) {
    try {
        const reason = body(req).reason;
        return ok(res, await TableReservationService.cancel(param(req, "id"), reason ? String(reason) : undefined));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function complete(req, res) {
    try {
        return ok(res, await TableReservationService.complete(param(req, "id")));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getSettings(_req, res) {
    try {
        return ok(res, await TableReservationService.getSettings());
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function saveSettings(req, res) {
    try {
        const b = body(req);
        const scopeKey = String(b.scopeKey ?? req.params.scopeKey ?? "global");
        return ok(res, await TableReservationService.saveSettings(scopeKey, b));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteSettings(req, res) {
    try {
        return ok(res, await TableReservationService.deleteSettings(param(req, "scopeKey")));
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=reservations.js.map
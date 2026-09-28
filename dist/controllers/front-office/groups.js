import { GroupService } from "../../services/front-office/group.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
import { groupBillingRulesUpdateSchema, groupCreateSchema, groupUpdateSchema, } from "../../validators/front-office-groups.js";
export async function listGroups(req, res) {
    try {
        const status = req.query.status;
        return ok(res, await GroupService.list(status));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getGroup(req, res) {
    try {
        return ok(res, await GroupService.getById(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createGroup(req, res) {
    try {
        const headerKey = String(req.headers["idempotency-key"] ?? "").trim();
        const body = parseBody(groupCreateSchema, {
            ...req.body,
            idempotencyKey: req.body?.idempotencyKey ||
                headerKey ||
                undefined,
        });
        return ok(res, await GroupService.create(body), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateGroup(req, res) {
    try {
        const body = parseBody(groupUpdateSchema, req.body);
        return ok(res, await GroupService.update(String(req.params.id), body));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listGroupReservations(req, res) {
    try {
        return ok(res, await GroupService.listReservations(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getGroupFolio(req, res) {
    try {
        const folio = await GroupService.getMasterFolio(String(req.params.id));
        if (!folio)
            return fail(res, "Master folio not found", 404);
        return ok(res, folio);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listGroupBillingRules(req, res) {
    try {
        return ok(res, await GroupService.listBillingRules(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateGroupBillingRules(req, res) {
    try {
        const body = parseBody(groupBillingRulesUpdateSchema, req.body);
        return ok(res, await GroupService.updateBillingRules(String(req.params.id), body.rules));
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=groups.js.map
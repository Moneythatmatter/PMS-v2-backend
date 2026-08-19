import { MaintenanceRequestService } from "../../services/housekeeping/maintenance-request.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listMaintenanceRequests(req, res) {
    try {
        const rows = await MaintenanceRequestService.list({
            status: req.query.status,
            roomId: req.query.roomId,
            publicAreaId: req.query.publicAreaId,
            issueType: req.query.issueType,
            priority: req.query.priority,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getMaintenanceRequest(req, res) {
    try {
        return ok(res, await MaintenanceRequestService.get(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createMaintenanceRequest(req, res) {
    try {
        const row = await MaintenanceRequestService.create((req.body ?? {}));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateMaintenanceRequest(req, res) {
    try {
        const row = await MaintenanceRequestService.update(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function assignMaintenanceRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const assignedTo = String(body.assignedTo ?? body.engineer ?? "").trim();
        if (!assignedTo)
            return fail(res, "assignedTo is required", 400);
        const row = await MaintenanceRequestService.assign(String(req.params.id), assignedTo, body.estimatedCompletionAt ?? body.estimatedCompletion);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function startMaintenanceRequest(req, res) {
    try {
        const row = await MaintenanceRequestService.start(String(req.params.id));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function completeMaintenanceRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await MaintenanceRequestService.complete(String(req.params.id), body.resolution, body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function verifyMaintenanceRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const verifiedBy = String(body.verifiedBy ?? "").trim();
        if (!verifiedBy)
            return fail(res, "verifiedBy is required", 400);
        const row = await MaintenanceRequestService.verify(String(req.params.id), verifiedBy, body.resolution);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function cancelMaintenanceRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await MaintenanceRequestService.cancel(String(req.params.id), body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=maintenance-requests.js.map
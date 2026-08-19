import { GuestRequestService } from "../../services/housekeeping/guest-request.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listGuestRequests(req, res) {
    try {
        const rows = await GuestRequestService.list({
            status: req.query.status,
            roomId: req.query.roomId,
            bookingId: req.query.bookingId,
            requestType: req.query.requestType,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getGuestRequest(req, res) {
    try {
        return ok(res, await GuestRequestService.get(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createGuestRequest(req, res) {
    try {
        const row = await GuestRequestService.create((req.body ?? {}));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateGuestRequest(req, res) {
    try {
        const row = await GuestRequestService.update(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function assignGuestRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const assignedTo = String(body.assignedTo ?? body.assignedStaff ?? "").trim();
        if (!assignedTo)
            return fail(res, "assignedTo is required", 400);
        const row = await GuestRequestService.assign(String(req.params.id), assignedTo);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function startGuestRequest(req, res) {
    try {
        const row = await GuestRequestService.start(String(req.params.id));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function completeGuestRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await GuestRequestService.complete(String(req.params.id), body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function cancelGuestRequest(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await GuestRequestService.cancel(String(req.params.id), body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=guest-requests.js.map
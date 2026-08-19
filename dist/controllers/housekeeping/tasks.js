import { HkTaskService } from "../../services/housekeeping/hk-task.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
export async function listTasks(req, res) {
    try {
        const rows = await HkTaskService.list({
            status: req.query.status,
            roomId: req.query.roomId,
            bookingId: req.query.bookingId,
            taskType: req.query.taskType,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getActiveTaskForRoom(req, res) {
    try {
        const row = await HkTaskService.findActiveForRoom(String(req.params.roomId));
        if (!row)
            return fail(res, "No active task for room", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getTask(req, res) {
    try {
        return ok(res, await HkTaskService.get(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createTask(req, res) {
    try {
        const row = await HkTaskService.create((req.body ?? {}));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function assignTask(req, res) {
    try {
        const body = (req.body ?? {});
        const assignedTo = String(body.assignedTo ?? body.assignedStaff ?? "").trim();
        if (!assignedTo)
            return fail(res, "assignedTo is required", 400);
        const row = await HkTaskService.assign(String(req.params.id), assignedTo);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function startTask(req, res) {
    try {
        const row = await HkTaskService.start(String(req.params.id));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function completeTask(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await HkTaskService.complete(String(req.params.id), body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function approveTask(req, res) {
    try {
        const body = (req.body ?? {});
        const approvedBy = String(body.approvedBy ?? body.inspector ?? "Supervisor").trim();
        const row = await HkTaskService.approve(String(req.params.id), approvedBy);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function cancelTask(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await HkTaskService.cancel(String(req.params.id), body.notes ?? body.remarks);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=tasks.js.map
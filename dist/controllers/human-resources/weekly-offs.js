import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import { findEmployeeConflicts, findStaffingPreview, formatConflictMessage, } from "../../services/human-resources/weekly-off/weekly-off.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
function propertyId(req) {
    const id = req.propertyId;
    if (!id)
        throw new Error("Property context required");
    return id;
}
export async function listWeeklyOffs(req, res) {
    try {
        const pid = propertyId(req);
        const rows = await hrModel.list(hrTables.weeklyOffs, {
            filters: { property_id: pid },
            orderBy: "effective_from",
            ascending: false,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getWeeklyOff(req, res) {
    try {
        const pid = propertyId(req);
        const row = await hrModel.get(hrTables.weeklyOffs, String(req.params.id));
        if (!row || row.propertyId !== pid) {
            return fail(res, "Weekly off assignment not found", 404);
        }
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getStaffingPreview(req, res) {
    try {
        const pid = propertyId(req);
        const day = String(req.query.day ?? "");
        const effectiveFrom = String(req.query.effectiveFrom ?? "");
        const effectiveTo = String(req.query.effectiveTo ?? effectiveFrom);
        const department = req.query.department ? String(req.query.department) : undefined;
        const excludeEmployeeId = req.query.excludeEmployeeId
            ? String(req.query.excludeEmployeeId)
            : undefined;
        if (!day || !effectiveFrom) {
            return fail(res, "day and effectiveFrom are required", 400);
        }
        const result = await findStaffingPreview({
            propertyId: pid,
            day,
            effectiveFrom,
            effectiveTo,
            department,
            excludeEmployeeId,
        });
        return ok(res, result);
    }
    catch (e) {
        return fromError(res, e);
    }
}
async function validateWeeklyOffBody(pid, body, excludeId) {
    const employeeId = String(body.employeeId ?? "");
    const effectiveFrom = String(body.effectiveFrom ?? "").slice(0, 10);
    const effectiveTo = body.effectiveTo ? String(body.effectiveTo).slice(0, 10) : null;
    const days = Array.isArray(body.days) ? body.days : [];
    if (!employeeId)
        return { error: "employeeId is required", status: 400 };
    if (!effectiveFrom)
        return { error: "effectiveFrom is required", status: 400 };
    if (effectiveTo && effectiveFrom > effectiveTo) {
        return { error: "effectiveFrom must be on or before effectiveTo", status: 400 };
    }
    if (days.length === 0) {
        return { error: "At least one weekly off day is required", status: 400 };
    }
    const emp = await hrModel.get(hrTables.employees, employeeId);
    if (!emp || emp.propertyId !== pid) {
        return { error: "Employee not found for this property", status: 404 };
    }
    const conflicts = await findEmployeeConflicts({
        propertyId: pid,
        employeeId,
        days,
        effectiveFrom,
        effectiveTo,
        excludeId,
    });
    if (conflicts.length > 0) {
        return { error: formatConflictMessage(conflicts), status: 409 };
    }
    return {};
}
export async function createWeeklyOff(req, res) {
    try {
        const pid = propertyId(req);
        const body = { ...req.body };
        if (!body.id)
            body.id = newId();
        body.propertyId = pid;
        if (!body.status)
            body.status = "Active";
        const validation = await validateWeeklyOffBody(pid, body);
        if (validation.error)
            return fail(res, validation.error, validation.status ?? 400);
        const row = await hrModel.create(hrTables.weeklyOffs, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateWeeklyOff(req, res) {
    try {
        const pid = propertyId(req);
        const id = String(req.params.id);
        const existing = await hrModel.get(hrTables.weeklyOffs, id);
        if (!existing || existing.propertyId !== pid) {
            return fail(res, "Weekly off assignment not found", 404);
        }
        const body = { ...req.body };
        delete body.id;
        delete body.propertyId;
        const merged = {
            employeeId: body.employeeId ?? existing.employeeId,
            effectiveFrom: body.effectiveFrom ?? existing.effectiveFrom,
            effectiveTo: body.effectiveTo !== undefined
                ? body.effectiveTo
                : existing.effectiveTo,
            days: body.days ?? existing.days,
        };
        const validation = await validateWeeklyOffBody(pid, merged, id);
        if (validation.error)
            return fail(res, validation.error, validation.status ?? 400);
        const row = await hrModel.update(hrTables.weeklyOffs, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteWeeklyOff(req, res) {
    try {
        const pid = propertyId(req);
        const id = String(req.params.id);
        const existing = await hrModel.get(hrTables.weeklyOffs, id);
        if (!existing || existing.propertyId !== pid) {
            return fail(res, "Weekly off assignment not found", 404);
        }
        await hrModel.remove(hrTables.weeklyOffs, id);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=weekly-offs.js.map
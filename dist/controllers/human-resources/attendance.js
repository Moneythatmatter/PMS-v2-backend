import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { correctAttendance, punchIn, punchOut, recalculateAttendance, } from "../../services/human-resources/attendance/attendance.service.js";
import { processAbsenceForProperty } from "../../services/human-resources/attendance/absence-processor.js";
import { enrichAttendanceRecords } from "../../services/human-resources/attendance/enrich.js";
function propertyId(req) {
    const id = req.propertyId;
    if (!id)
        throw new Error("Property context required");
    return id;
}
export async function listAttendance(req, res) {
    try {
        const pid = propertyId(req);
        const filters = { property_id: pid };
        if (req.query.employeeId)
            filters.employee_id = String(req.query.employeeId);
        if (req.query.attendanceDate)
            filters.attendance_date = String(req.query.attendanceDate);
        if (req.query.fromDate && req.query.toDate) {
            // listRows doesn't support range — fetch ordered and filter in memory for now
        }
        let rows = await hrModel.list(hrTables.attendanceRecords, {
            filters,
            orderBy: "attendance_date",
            ascending: false,
        });
        const fromDate = req.query.fromDate ? String(req.query.fromDate).slice(0, 10) : null;
        const toDate = req.query.toDate ? String(req.query.toDate).slice(0, 10) : null;
        if (fromDate || toDate) {
            rows = rows.filter((r) => {
                const d = r.attendanceDate?.slice(0, 10) ?? "";
                if (fromDate && d < fromDate)
                    return false;
                if (toDate && d > toDate)
                    return false;
                return true;
            });
        }
        return ok(res, await enrichAttendanceRecords(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getAttendance(req, res) {
    try {
        const pid = propertyId(req);
        const row = await hrModel.get(hrTables.attendanceRecords, String(req.params.id));
        if (!row || row.propertyId !== pid) {
            return fail(res, "Attendance record not found", 404);
        }
        const enriched = await enrichAttendanceRecords([row]);
        return ok(res, enriched[0]);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function postPunchIn(req, res) {
    try {
        const pid = propertyId(req);
        const body = req.body;
        const employeeId = String(body.employeeId ?? "");
        if (!employeeId)
            return fail(res, "employeeId is required", 400);
        const row = await punchIn({
            propertyId: pid,
            employeeId,
            attendanceDate: body.attendanceDate,
            punchInAt: body.punchInAt,
            source: body.source ?? "MANUAL",
            changedBy: body.changedBy ?? req.auth?.userId,
            remarks: body.remarks,
        });
        const enriched = await enrichAttendanceRecords([row]);
        return ok(res, enriched[0], 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function postPunchOut(req, res) {
    try {
        const pid = propertyId(req);
        const body = req.body;
        const employeeId = String(body.employeeId ?? "");
        if (!employeeId)
            return fail(res, "employeeId is required", 400);
        const row = await punchOut({
            propertyId: pid,
            employeeId,
            attendanceDate: body.attendanceDate,
            punchOutAt: body.punchOutAt,
            source: body.source ?? "MANUAL",
            changedBy: body.changedBy ?? req.auth?.userId,
            remarks: body.remarks,
        });
        const enriched = await enrichAttendanceRecords([row]);
        return ok(res, enriched[0]);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function postCorrect(req, res) {
    try {
        const pid = propertyId(req);
        const body = req.body;
        const overrideReason = String(body.overrideReason ?? body.manualReason ?? "").trim();
        if (!overrideReason)
            return fail(res, "overrideReason is required", 400);
        const row = await correctAttendance({
            propertyId: pid,
            attendanceId: String(req.params.id),
            punchIn: body.punchIn,
            punchOut: body.punchOut,
            attendanceStatus: body.attendanceStatus,
            remarks: body.remarks,
            changedBy: body.changedBy ?? req.auth?.userId,
            overrideReason,
        });
        const enriched = await enrichAttendanceRecords([row]);
        return ok(res, enriched[0]);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function postRecalculate(req, res) {
    try {
        const pid = propertyId(req);
        const row = await recalculateAttendance(pid, String(req.params.id), req.auth?.userId);
        const enriched = await enrichAttendanceRecords([row]);
        return ok(res, enriched[0]);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function postProcessAbsence(req, res) {
    try {
        const pid = propertyId(req);
        const body = req.body;
        const result = await processAbsenceForProperty(pid, {
            attendanceDate: body.attendanceDate,
        });
        return ok(res, result);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getDailyAttendance(req, res) {
    try {
        const pid = propertyId(req);
        const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
        const rows = await hrModel.list(hrTables.attendanceRecords, {
            filters: { property_id: pid, attendance_date: date },
            orderBy: "employee_id",
        });
        return ok(res, await enrichAttendanceRecords(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getEmployeeAttendance(req, res) {
    try {
        const pid = propertyId(req);
        const employeeId = String(req.params.employeeId);
        const rows = await hrModel.list(hrTables.attendanceRecords, {
            filters: { property_id: pid, employee_id: employeeId },
            orderBy: "attendance_date",
            ascending: false,
        });
        return ok(res, await enrichAttendanceRecords(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=attendance.js.map
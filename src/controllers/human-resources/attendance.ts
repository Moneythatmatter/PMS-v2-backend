import type { Request, Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import {
  correctAttendance,
  findDailyRecord,
  punchIn,
  punchOut,
  recalculateAttendance,
} from "../../services/human-resources/attendance/attendance.service.js";
import { processAbsenceForProperty } from "../../services/human-resources/attendance/absence-processor.js";
import { enrichAttendanceRecords } from "../../services/human-resources/attendance/enrich.js";

function propertyId(req: ContextRequest): string {
  const id = req.propertyId;
  if (!id) throw new Error("Property context required");
  return id;
}

export async function listAttendance(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const filters: Record<string, string> = { property_id: pid };
    if (req.query.employeeId) filters.employee_id = String(req.query.employeeId);
    if (req.query.attendanceDate) filters.attendance_date = String(req.query.attendanceDate);
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
      rows = (rows as { attendanceDate?: string }[]).filter((r) => {
        const d = r.attendanceDate?.slice(0, 10) ?? "";
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }

    return ok(res, await enrichAttendanceRecords(rows as Record<string, unknown>[]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getAttendance(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const row = await hrModel.get(hrTables.attendanceRecords, String(req.params.id));
    if (!row || (row as { propertyId?: string }).propertyId !== pid) {
      return fail(res, "Attendance record not found", 404);
    }
    const enriched = await enrichAttendanceRecords([row as Record<string, unknown>]);
    return ok(res, enriched[0]);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postPunchIn(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = req.body as Record<string, unknown>;
    const employeeId = String(body.employeeId ?? "");
    if (!employeeId) return fail(res, "employeeId is required", 400);

    const row = await punchIn({
      propertyId: pid,
      employeeId,
      attendanceDate: body.attendanceDate as string | undefined,
      punchInAt: body.punchInAt as string | undefined,
      source: (body.source as string) ?? "MANUAL",
      changedBy: (body.changedBy as string) ?? req.auth?.userId,
      remarks: body.remarks as string | undefined,
    });
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0], 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postPunchOut(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = req.body as Record<string, unknown>;
    const employeeId = String(body.employeeId ?? "");
    if (!employeeId) return fail(res, "employeeId is required", 400);

    const row = await punchOut({
      propertyId: pid,
      employeeId,
      attendanceDate: body.attendanceDate as string | undefined,
      punchOutAt: body.punchOutAt as string | undefined,
      source: (body.source as string) ?? "MANUAL",
      changedBy: (body.changedBy as string) ?? req.auth?.userId,
      remarks: body.remarks as string | undefined,
    });
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0]);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postCorrect(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = req.body as Record<string, unknown>;
    const overrideReason = String(body.overrideReason ?? body.manualReason ?? "").trim();
    if (!overrideReason) return fail(res, "overrideReason is required", 400);

    const row = await correctAttendance({
      propertyId: pid,
      attendanceId: String(req.params.id),
      punchIn: body.punchIn as string | null | undefined,
      punchOut: body.punchOut as string | null | undefined,
      attendanceStatus: body.attendanceStatus as string | undefined,
      remarks: body.remarks as string | undefined,
      changedBy: (body.changedBy as string) ?? req.auth?.userId,
      overrideReason,
    });
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0]);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postRecalculate(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const row = await recalculateAttendance(
      pid,
      String(req.params.id),
      req.auth?.userId,
    );
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0]);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postProcessAbsence(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = req.body as Record<string, unknown>;
    const result = await processAbsenceForProperty(pid, {
      attendanceDate: body.attendanceDate as string | undefined,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getDailyAttendance(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const rows = await hrModel.list(hrTables.attendanceRecords, {
      filters: { property_id: pid, attendance_date: date },
      orderBy: "employee_id",
    });
    return ok(res, await enrichAttendanceRecords(rows as Record<string, unknown>[]));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getEmployeeAttendance(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const employeeId = String(req.params.employeeId);
    const rows = await hrModel.list(hrTables.attendanceRecords, {
      filters: { property_id: pid, employee_id: employeeId },
      orderBy: "attendance_date",
      ascending: false,
    });
    return ok(res, await enrichAttendanceRecords(rows as Record<string, unknown>[]));
  } catch (e) {
    return fromError(res, e);
  }
}

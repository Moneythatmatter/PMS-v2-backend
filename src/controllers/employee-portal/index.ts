import type { Request, Response } from "express";
import type { EmployeePortalRequest } from "../../middleware/employee-portal.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import { fail, fromError, ok } from "../../utils/response.js";
import {
  assertOwnEmployeeRecord,
} from "../../services/employee-portal/employee-context.service.js";
import {
  getEmployeeDashboard,
  toEmployeeProfile,
} from "../../services/employee-portal/employee-portal.service.js";
import {
  findDailyRecord,
  punchIn,
  punchOut,
} from "../../services/human-resources/attendance/attendance.service.js";
import { enrichAttendanceRecords } from "../../services/human-resources/attendance/enrich.js";
import { enrichEmployee } from "../../services/human-resources/enrich.js";
import {
  cancelLeave,
  enrichLeaveApplicationOnCreate,
  previewLeaveDays,
} from "../../services/human-resources/leave/leave-lifecycle.service.js";

function portalReq(req: Request): EmployeePortalRequest {
  return req as EmployeePortalRequest;
}

function ctx(req: Request) {
  const er = portalReq(req);
  return {
    propertyId: er.propertyId!,
    employeeId: er.employeeId,
  };
}

export async function getDashboard(req: Request, res: Response) {
  try {
    const data = await getEmployeeDashboard(ctx(req));
    return ok(res, data);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getTodayAttendance(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const row = await findDailyRecord(propertyId, employeeId, date);
    if (!row) return ok(res, null);
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0] ?? null);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listMyAttendance(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    let rows = await hrModel.list(hrTables.attendanceRecords, {
      filters: { property_id: propertyId, employee_id: employeeId },
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

export async function postPunchIn(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const body = req.body as Record<string, unknown>;
    const row = await punchIn({
      propertyId,
      employeeId,
      attendanceDate: body.attendanceDate as string | undefined,
      punchInAt: body.punchInAt as string | undefined,
      source: "MANUAL",
      changedBy: portalReq(req).auth?.userId,
      remarks: body.remarks as string | undefined,
    });
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0], 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function postPunchOut(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const body = req.body as Record<string, unknown>;
    const row = await punchOut({
      propertyId,
      employeeId,
      attendanceDate: body.attendanceDate as string | undefined,
      punchOutAt: body.punchOutAt as string | undefined,
      source: "MANUAL",
      changedBy: portalReq(req).auth?.userId,
      remarks: body.remarks as string | undefined,
    });
    const enriched = await enrichAttendanceRecords([row as unknown as Record<string, unknown>]);
    return ok(res, enriched[0]);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMySchedule(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const [shifts, weeklyOffs] = await Promise.all([
      hrModel.list(hrTables.shiftAssignments, {
        filters: { property_id: propertyId, employee_id: employeeId },
        orderBy: "effective_from",
        ascending: false,
      }),
      hrModel.list(hrTables.weeklyOffs, {
        filters: { property_id: propertyId, employee_id: employeeId },
        orderBy: "created_at",
        ascending: false,
      }),
    ]);
    return ok(res, { shifts, weeklyOffs });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listMyLeaveTypes(req: Request, res: Response) {
  try {
    const { propertyId } = ctx(req);
    const rows = await hrModel.list(hrTables.leaveTypes, {
      filters: { property_id: propertyId, status: "Active" },
      orderBy: "leave_code",
      ascending: true,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLeaveBalance(req: Request, res: Response) {
  try {
    const { employeeId } = ctx(req);
    const emp = await hrModel.get<{ leaveBalance?: Record<string, number> }>(
      hrTables.employees,
      employeeId,
    );
    return ok(res, emp?.leaveBalance ?? { casual: 0, sick: 0, earned: 0 });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listMyLeaveApplications(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const rows = await hrModel.list(hrTables.leaveApplications, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "applied_on",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function previewMyLeaveDays(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const body = req.body as Record<string, unknown>;
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? body.fromDate ?? "");
    const durationOption = body.durationOption ? String(body.durationOption) : undefined;
    if (!fromDate) return fail(res, "fromDate is required", 400);

    const result = await previewLeaveDays({
      propertyId,
      employeeId,
      fromDate,
      toDate,
      durationOption,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createMyLeaveApplication(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const body = { ...(req.body as Record<string, unknown>) };
    body.id = body.id ?? newId();
    body.propertyId = propertyId;
    body.employeeId = employeeId;
    body.status = "Pending";
    body.appliedBy = portalReq(req).auth?.userId ?? employeeId;

    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? fromDate);
    const durationOption = body.durationOption ? String(body.durationOption) : "Full Day";

    if (fromDate) {
      const enriched = await enrichLeaveApplicationOnCreate({
        propertyId,
        employeeId,
        fromDate,
        toDate,
        durationOption,
      });
      body.calendarDays = enriched.calendarDays;
      body.totalDays = enriched.calendarDays;
      body.excludedDates = enriched.excludedDates;
    }

    const row = await hrModel.create(hrTables.leaveApplications, body);
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMyLeaveApplication(req: Request, res: Response) {
  try {
    const c = ctx(req);
    const row = await hrModel.get<{ propertyId?: string; employeeId?: string }>(
      hrTables.leaveApplications,
      String(req.params.id),
    );
    if (!row) return fail(res, "Leave application not found", 404);
    assertOwnEmployeeRecord(row, c);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelMyLeaveApplication(req: Request, res: Response) {
  try {
    const c = ctx(req);
    const id = String(req.params.id);
    const existing = await hrModel.get<{ status: string; propertyId?: string; employeeId?: string }>(
      hrTables.leaveApplications,
      id,
    );
    if (!existing) return fail(res, "Leave application not found", 404);
    assertOwnEmployeeRecord(existing, c);

    if (existing.status === "Approved") {
      const result = await cancelLeave({
        propertyId: c.propertyId,
        leaveRequestId: id,
        changedBy: portalReq(req).auth?.userId ?? c.employeeId,
      });
      return ok(res, result);
    }

    if (existing.status !== "Pending") {
      return fail(res, "Only pending or approved leave can be cancelled", 400);
    }

    const row = await hrModel.update(hrTables.leaveApplications, id, {
      status: "Cancelled",
      updatedAt: new Date().toISOString(),
    });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listMyOvertime(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const rows = await hrModel.list(hrTables.overtimeRecords, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "record_date",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listMyPayslips(req: Request, res: Response) {
  try {
    const { propertyId, employeeId } = ctx(req);
    const rows = await hrModel.list(hrTables.payslips, {
      filters: { property_id: propertyId, employee_id: employeeId },
      orderBy: "generated_date",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMyPayslip(req: Request, res: Response) {
  try {
    const c = ctx(req);
    const row = await hrModel.get<{ propertyId?: string; employeeId?: string }>(
      hrTables.payslips,
      String(req.params.id),
    );
    if (!row) return fail(res, "Payslip not found", 404);
    assertOwnEmployeeRecord(row, c);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMyProfile(req: Request, res: Response) {
  try {
    const { employeeId } = ctx(req);
    const raw = await hrModel.get(hrTables.employees, employeeId);
    if (!raw) return fail(res, "Employee profile not found", 404);
    const enriched = await enrichEmployee(raw as Parameters<typeof enrichEmployee>[0]);
    return ok(res, toEmployeeProfile(enriched as Record<string, unknown>));
  } catch (e) {
    return fromError(res, e);
  }
}

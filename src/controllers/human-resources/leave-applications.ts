import type { Request, Response } from "express";
import type { ContextRequest } from "../../middleware/request-context.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
import {
  approveLeave,
  cancelLeave,
  enrichLeaveApplicationOnCreate,
  modifyLeave,
  previewLeaveDays,
} from "../../services/human-resources/leave/leave-lifecycle.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

function propertyId(req: ContextRequest): string {
  const id = req.propertyId;
  if (!id) throw new Error("Property context required");
  return id;
}

export async function listLeaveApplications(req: ContextRequest, res: Response) {
  try {
    const rows = await hrModel.list(hrTables.leaveApplications, {
      orderBy: "applied_on",
      ascending: false,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const row = await hrModel.get(hrTables.leaveApplications, String(req.params.id));
    if (!row || (row as { propertyId?: string }).propertyId !== pid) {
      return fail(res, "Leave application not found", 404);
    }
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function previewLeaveApplicationDays(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = req.body as Record<string, unknown>;
    const employeeId = String(body.employeeId ?? "");
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? body.fromDate ?? "");
    const durationOption = body.durationOption ? String(body.durationOption) : undefined;

    if (!employeeId || !fromDate) {
      return fail(res, "employeeId and fromDate are required", 400);
    }

    const result = await previewLeaveDays({
      propertyId: pid,
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

export async function createLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const body = { ...(req.body as Record<string, unknown>) };
    if (!body.id) body.id = newId();
    body.propertyId = pid;

    const employeeId = String(body.employeeId ?? "");
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? fromDate);
    const durationOption = body.durationOption ? String(body.durationOption) : "Full Day";

    if (employeeId && fromDate) {
      const enriched = await enrichLeaveApplicationOnCreate({
        propertyId: pid,
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

export async function updateLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const id = String(req.params.id);
    const existing = await hrModel.get<{
      status: string;
      propertyId: string;
      fromDate: string;
      toDate: string;
      durationOption?: string;
    }>(hrTables.leaveApplications, id);
    if (!existing || existing.propertyId !== pid) {
      return fail(res, "Leave application not found", 404);
    }

    const body = { ...(req.body as Record<string, unknown>) };
    delete body.id;
    delete body.propertyId;

    const newStatus = String((body.status as string) ?? existing.status);
    const changedBy = String(body.approvedBy ?? req.auth?.userId ?? "HR");

    if (newStatus === "Cancelled" && existing.status === "Approved") {
      const result = await cancelLeave({
        propertyId: pid,
        leaveRequestId: id,
        changedBy,
      });
      return ok(res, result);
    }

    if (
      existing.status === "Approved" &&
      (body.fromDate || body.toDate) &&
      (String(body.fromDate ?? existing.fromDate) !== existing.fromDate.slice(0, 10) ||
        String(body.toDate ?? existing.toDate) !== existing.toDate.slice(0, 10))
    ) {
      const result = await modifyLeave({
        propertyId: pid,
        leaveRequestId: id,
        fromDate: String(body.fromDate ?? existing.fromDate).slice(0, 10),
        toDate: String(body.toDate ?? existing.toDate).slice(0, 10),
        changedBy,
        durationOption: body.durationOption ? String(body.durationOption) : existing.durationOption,
      });
      return ok(res, result);
    }

    if (newStatus === "Approved" && existing.status !== "Approved") {
      const result = await approveLeave({
        propertyId: pid,
        leaveRequestId: id,
        approvedBy: changedBy,
      });
      return ok(res, result);
    }

    const row = await hrModel.update(hrTables.leaveApplications, id, body);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteLeaveApplication(req: Request, res: Response) {
  try {
    await hrModel.remove(hrTables.leaveApplications, String(req.params.id));
    return ok(res, { id: req.params.id });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approveLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const id = String(req.params.id);
    const body = req.body as Record<string, unknown>;
    const approvedBy = String(body.approvedBy ?? req.auth?.userId ?? "HR");

    const result = await approveLeave({
      propertyId: pid,
      leaveRequestId: id,
      approvedBy,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const id = String(req.params.id);
    const body = req.body as Record<string, unknown>;
    const changedBy = String(body.changedBy ?? req.auth?.userId ?? "HR");
    const newToDate = body.newToDate ? String(body.newToDate) : undefined;

    const result = await cancelLeave({
      propertyId: pid,
      leaveRequestId: id,
      changedBy,
      newToDate,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function modifyLeaveApplication(req: ContextRequest, res: Response) {
  try {
    const pid = propertyId(req);
    const id = String(req.params.id);
    const body = req.body as Record<string, unknown>;
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? "");
    const changedBy = String(body.changedBy ?? req.auth?.userId ?? "HR");

    if (!fromDate || !toDate) {
      return fail(res, "fromDate and toDate are required", 400);
    }

    const result = await modifyLeave({
      propertyId: pid,
      leaveRequestId: id,
      fromDate,
      toDate,
      changedBy,
      durationOption: body.durationOption ? String(body.durationOption) : undefined,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

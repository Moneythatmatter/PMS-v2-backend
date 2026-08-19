import type { Request, Response } from "express";
import { HkTaskService } from "../../services/housekeeping/hk-task.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function listTasks(req: Request, res: Response) {
  try {
    const rows = await HkTaskService.list({
      status: req.query.status as string | undefined,
      roomId: req.query.roomId as string | undefined,
      bookingId: req.query.bookingId as string | undefined,
      taskType: req.query.taskType as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getActiveTaskForRoom(req: Request, res: Response) {
  try {
    const row = await HkTaskService.findActiveForRoom(String(req.params.roomId));
    if (!row) return fail(res, "No active task for room", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getTask(req: Request, res: Response) {
  try {
    return ok(res, await HkTaskService.get(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createTask(req: Request, res: Response) {
  try {
    const row = await HkTaskService.create(
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function assignTask(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { assignedTo?: string; assignedStaff?: string };
    const assignedTo = String(body.assignedTo ?? body.assignedStaff ?? "").trim();
    if (!assignedTo) return fail(res, "assignedTo is required", 400);
    const row = await HkTaskService.assign(String(req.params.id), assignedTo);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function startTask(req: Request, res: Response) {
  try {
    const row = await HkTaskService.start(String(req.params.id));
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function completeTask(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { notes?: string; remarks?: string };
    const row = await HkTaskService.complete(
      String(req.params.id),
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function approveTask(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      approvedBy?: string;
      inspector?: string;
    };
    const approvedBy = String(
      body.approvedBy ?? body.inspector ?? "Supervisor",
    ).trim();
    const row = await HkTaskService.approve(String(req.params.id), approvedBy);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelTask(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { notes?: string; remarks?: string };
    const row = await HkTaskService.cancel(
      String(req.params.id),
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

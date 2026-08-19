import type { Request, Response } from "express";
import { MaintenanceRequestService } from "../../services/housekeeping/maintenance-request.service.js";
import { fail, fromError, ok } from "../../utils/response.js";

export async function listMaintenanceRequests(req: Request, res: Response) {
  try {
    const rows = await MaintenanceRequestService.list({
      status: req.query.status as string | undefined,
      roomId: req.query.roomId as string | undefined,
      publicAreaId: req.query.publicAreaId as string | undefined,
      issueType: req.query.issueType as string | undefined,
      priority: req.query.priority as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getMaintenanceRequest(req: Request, res: Response) {
  try {
    return ok(res, await MaintenanceRequestService.get(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createMaintenanceRequest(req: Request, res: Response) {
  try {
    const row = await MaintenanceRequestService.create(
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateMaintenanceRequest(req: Request, res: Response) {
  try {
    const row = await MaintenanceRequestService.update(
      String(req.params.id),
      (req.body ?? {}) as Record<string, unknown>,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function assignMaintenanceRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      assignedTo?: string;
      engineer?: string;
      estimatedCompletion?: string;
      estimatedCompletionAt?: string;
    };
    const assignedTo = String(
      body.assignedTo ?? body.engineer ?? "",
    ).trim();
    if (!assignedTo) return fail(res, "assignedTo is required", 400);
    const row = await MaintenanceRequestService.assign(
      String(req.params.id),
      assignedTo,
      body.estimatedCompletionAt ?? body.estimatedCompletion,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function startMaintenanceRequest(req: Request, res: Response) {
  try {
    const row = await MaintenanceRequestService.start(String(req.params.id));
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function completeMaintenanceRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      resolution?: string;
      notes?: string;
      remarks?: string;
    };
    const row = await MaintenanceRequestService.complete(
      String(req.params.id),
      body.resolution,
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function verifyMaintenanceRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as {
      verifiedBy?: string;
      resolution?: string;
    };
    const verifiedBy = String(body.verifiedBy ?? "").trim();
    if (!verifiedBy) return fail(res, "verifiedBy is required", 400);
    const row = await MaintenanceRequestService.verify(
      String(req.params.id),
      verifiedBy,
      body.resolution,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancelMaintenanceRequest(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { notes?: string; remarks?: string };
    const row = await MaintenanceRequestService.cancel(
      String(req.params.id),
      body.notes ?? body.remarks,
    );
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

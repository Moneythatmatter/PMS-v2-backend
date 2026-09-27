import type { Request, Response } from "express";
import { GroupService } from "../../services/front-office/group.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
import {
  groupBillingRulesUpdateSchema,
  groupCreateSchema,
  groupUpdateSchema,
} from "../../validators/front-office-groups.js";

export async function listGroups(req: Request, res: Response) {
  try {
    const status = req.query.status as string | undefined;
    return ok(res, await GroupService.list(status));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getGroup(req: Request, res: Response) {
  try {
    return ok(res, await GroupService.getById(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createGroup(req: Request, res: Response) {
  try {
    const headerKey = String(req.headers["idempotency-key"] ?? "").trim();
    const body = parseBody(groupCreateSchema, {
      ...req.body,
      idempotencyKey:
        (req.body as { idempotencyKey?: string })?.idempotencyKey ||
        headerKey ||
        undefined,
    }) as Parameters<typeof GroupService.create>[0];
    return ok(res, await GroupService.create(body), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateGroup(req: Request, res: Response) {
  try {
    const body = parseBody(groupUpdateSchema, req.body) as Parameters<
      typeof GroupService.update
    >[1];
    return ok(res, await GroupService.update(String(req.params.id), body));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listGroupReservations(req: Request, res: Response) {
  try {
    return ok(
      res,
      await GroupService.listReservations(String(req.params.id)),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getGroupFolio(req: Request, res: Response) {
  try {
    const folio = await GroupService.getMasterFolio(String(req.params.id));
    if (!folio) return fail(res, "Master folio not found", 404);
    return ok(res, folio);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listGroupBillingRules(req: Request, res: Response) {
  try {
    return ok(res, await GroupService.listBillingRules(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateGroupBillingRules(req: Request, res: Response) {
  try {
    const body = parseBody(groupBillingRulesUpdateSchema, req.body) as {
      rules: { chargeCategory: string; responsibility: string }[];
    };
    return ok(
      res,
      await GroupService.updateBillingRules(String(req.params.id), body.rules),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

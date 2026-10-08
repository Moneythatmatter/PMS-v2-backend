import type { Request, Response } from "express";
import { TableReservationService } from "../../services/food-beverages/table-reservations.service.js";
import { fromError, ok } from "../../utils/response.js";

type Body = Record<string, unknown>;

const param = (req: Request, key: string) => String(req.params[key] ?? "");
const query = (req: Request, key: string) => {
  const v = req.query[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const body = (req: Request) => (req.body ?? {}) as Body;

export async function list(req: Request, res: Response) {
  try {
    const rows = await TableReservationService.list({
      date: query(req, "date"),
      outletId: query(req, "outletId") ?? query(req, "outlet_id"),
      status: query(req, "status"),
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function get(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.get(param(req, "id")));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function create(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.create(body(req)), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function update(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.update(param(req, "id"), body(req)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    await TableReservationService.remove(param(req, "id"));
    return ok(res, { id: param(req, "id") });
  } catch (e) {
    return fromError(res, e);
  }
}

export async function seat(req: Request, res: Response) {
  try {
    const b = body(req);
    const result = await TableReservationService.seat(param(req, "id"), {
      tableNo: b.tableNo ? String(b.tableNo) : undefined,
      server: b.server ? String(b.server) : undefined,
      override: b.override === true,
    });
    return ok(res, result);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function markNoShow(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.markNoShow(param(req, "id")));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function cancel(req: Request, res: Response) {
  try {
    const reason = body(req).reason;
    return ok(res, await TableReservationService.cancel(param(req, "id"), reason ? String(reason) : undefined));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function complete(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.complete(param(req, "id")));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getSettings(_req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.getSettings());
  } catch (e) {
    return fromError(res, e);
  }
}

export async function saveSettings(req: Request, res: Response) {
  try {
    const b = body(req);
    const scopeKey = String(b.scopeKey ?? req.params.scopeKey ?? "global");
    return ok(res, await TableReservationService.saveSettings(scopeKey, b));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteSettings(req: Request, res: Response) {
  try {
    return ok(res, await TableReservationService.deleteSettings(param(req, "scopeKey")));
  } catch (e) {
    return fromError(res, e);
  }
}

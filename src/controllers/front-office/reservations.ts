import type { Request, Response } from "express";
import { ReservationService } from "../../services/front-office/reservation.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
import {
  reservationCreateSchema,
  reservationUpdateSchema,
} from "../../validators/front-office.js";

/**
 * Thin HTTP adapter — no business rules here.
 * All workflows live in ReservationService.
 */
export async function listReservations(req: Request, res: Response) {
  try {
    const status = req.query.status as string | undefined;
    return ok(res, await ReservationService.list(status));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getReservation(req: Request, res: Response) {
  try {
    return ok(res, await ReservationService.getById(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getCurrentForRoom(req: Request, res: Response) {
  try {
    const row = await ReservationService.findCurrentForRoom(
      String(req.params.roomId),
    );
    if (!row) return fail(res, "No booking for this room", 404);
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createReservation(req: Request, res: Response) {
  try {
    const body = parseBody(reservationCreateSchema, req.body) as Record<
      string,
      unknown
    >;
    return ok(res, await ReservationService.create(body), 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateReservation(req: Request, res: Response) {
  try {
    const body = parseBody(reservationUpdateSchema, req.body) as Record<
      string,
      unknown
    >;
    return ok(
      res,
      await ReservationService.update(String(req.params.id), body),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteReservation(req: Request, res: Response) {
  try {
    return ok(res, await ReservationService.remove(String(req.params.id)));
  } catch (e) {
    return fromError(res, e);
  }
}

export async function checkIn(req: Request, res: Response) {
  try {
    const extras = (req.body ?? {}) as Record<string, unknown>;
    return ok(
      res,
      await ReservationService.checkIn(String(req.params.id), extras),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function checkOut(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return ok(
      res,
      await ReservationService.checkOut(String(req.params.id), {
        paymentMode:
          typeof body.paymentMode === "string" ? body.paymentMode : undefined,
        amountReceived: Number(body.amountReceived ?? 0),
      }),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function extendStay(req: Request, res: Response) {
  try {
    const { checkOut, nights, totalAmount, balance } = req.body as Record<
      string,
      unknown
    >;
    if (!checkOut) return fail(res, "checkOut is required");
    return ok(
      res,
      await ReservationService.extendStay(String(req.params.id), {
        checkOut: String(checkOut),
        nights,
        totalAmount,
        balance,
      }),
    );
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getSummary(_req: Request, res: Response) {
  try {
    return ok(res, await ReservationService.getSummary());
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listInHouse(_req: Request, res: Response) {
  try {
    return ok(res, await ReservationService.listInHouse());
  } catch (e) {
    return fromError(res, e);
  }
}

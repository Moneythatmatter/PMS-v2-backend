import type { Request, Response, NextFunction } from "express";
import { TransactionService } from "../services/shared/transaction.service.js";
import { FolioService } from "../services/shared/folio.service.js";
import {
  fnbPaymentSchema,
  foPaymentSchema,
  reservationAdvanceSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
} from "../validators/transactions.js";
import { foModel } from "../models/front-office/index.js";
import { fail, ok } from "../utils/response.js";

function parseBody<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  return schema.parse(body);
}

export async function listTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId, folioId, guestId, sourceModule, sourceId, status } =
      req.query;
    const rows = await TransactionService.list({
      bookingId: bookingId as string | undefined,
      folioId: folioId as string | undefined,
      guestId: guestId as string | undefined,
      sourceModule: sourceModule as string | undefined,
      sourceId: sourceId as string | undefined,
      status: status as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    next(e);
  }
}

function paramId(req: Request): string {
  const id = req.params.id;
  const raw = Array.isArray(id) ? id[0] : id;
  if (!raw) throw new Error("Missing route id");
  return raw;
}

export async function getTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await TransactionService.get(paramId(req));
    if (!row) return fail(res, "Transaction not found", 404);
    return ok(res, row);
  } catch (e) {
    next(e);
  }
}

export async function createTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseBody(transactionCreateSchema, req.body);
    const row = await TransactionService.recordViaRpc(body);
    return ok(res, row, 201);
  } catch (e) {
    next(e);
  }
}

export async function updateTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseBody(transactionUpdateSchema, req.body);
    const row = await foModel.update(foModel.tables.transactions, paramId(req), body);
    return ok(res, row);
  } catch (e) {
    next(e);
  }
}

export async function recordFrontOfficePayment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseBody(foPaymentSchema, req.body);
    const row = await TransactionService.recordFrontOfficePayment(body);
    return ok(res, row, 201);
  } catch (e) {
    next(e);
  }
}

export async function recordFnbPayment(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseBody(fnbPaymentSchema, req.body);
    const row = await TransactionService.recordFnbPayment(body);
    return ok(res, row, 201);
  } catch (e) {
    next(e);
  }
}

export async function recordReservationAdvance(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseBody(reservationAdvanceSchema, req.body);
    const row = await TransactionService.recordReservationAdvance(body);
    return ok(res, row, 201);
  } catch (e) {
    next(e);
  }
}

export async function listFolios(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId, guestId, status } = req.query;
    const rows = await FolioService.list({
      bookingId: bookingId as string | undefined,
      guestId: guestId as string | undefined,
      status: status as string | undefined,
    });
    return ok(res, rows);
  } catch (e) {
    next(e);
  }
}

export async function getFolio(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await FolioService.getById(paramId(req));
    if (!row) return fail(res, "Folio not found", 404);
    return ok(res, row);
  } catch (e) {
    next(e);
  }
}

export async function ensureFolioForBooking(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { bookingId, guestId } = req.body as {
      bookingId?: string;
      guestId?: string | null;
    };
    if (!bookingId?.trim()) {
      return fail(res, "bookingId is required", 400);
    }
    const folioId = await TransactionService.ensureFolioForBooking(
      bookingId.trim(),
      guestId ?? null,
    );
    const folio = await FolioService.getById(folioId);
    return ok(res, folio ?? { id: folioId }, folio ? 200 : 201);
  } catch (e) {
    next(e);
  }
}

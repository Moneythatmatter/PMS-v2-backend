import { ReservationService } from "../../services/front-office/reservation.service.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
import { reservationCreateSchema, reservationUpdateSchema, } from "../../validators/front-office.js";
/**
 * Thin HTTP adapter — no business rules here.
 * All workflows live in ReservationService.
 */
export async function listReservations(req, res) {
    try {
        const status = req.query.status;
        return ok(res, await ReservationService.list(status));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getReservation(req, res) {
    try {
        return ok(res, await ReservationService.getById(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createReservation(req, res) {
    try {
        const body = parseBody(reservationCreateSchema, req.body);
        return ok(res, await ReservationService.create(body), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateReservation(req, res) {
    try {
        const body = parseBody(reservationUpdateSchema, req.body);
        return ok(res, await ReservationService.update(String(req.params.id), body));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteReservation(req, res) {
    try {
        return ok(res, await ReservationService.remove(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function checkIn(req, res) {
    try {
        const extras = (req.body ?? {});
        return ok(res, await ReservationService.checkIn(String(req.params.id), extras));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function checkOut(req, res) {
    try {
        const body = (req.body ?? {});
        return ok(res, await ReservationService.checkOut(String(req.params.id), {
            paymentMode: typeof body.paymentMode === "string" ? body.paymentMode : undefined,
            amountReceived: Number(body.amountReceived ?? 0),
        }));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function extendStay(req, res) {
    try {
        const { checkOut, nights, totalAmount, balance } = req.body;
        if (!checkOut)
            return fail(res, "checkOut is required");
        return ok(res, await ReservationService.extendStay(String(req.params.id), {
            checkOut: String(checkOut),
            nights,
            totalAmount,
            balance,
        }));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getSummary(_req, res) {
    try {
        return ok(res, await ReservationService.getSummary());
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function listInHouse(_req, res) {
    try {
        return ok(res, await ReservationService.listInHouse());
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=reservations.js.map
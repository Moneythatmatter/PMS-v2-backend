import { Router } from "express";
import {
  createCrudController,
  mountCrud,
} from "../controllers/front-office/crud.js";
import { getDashboard } from "../controllers/front-office/dashboard.js";
import { getReport } from "../controllers/front-office/reports.js";
import * as reservations from "../controllers/front-office/reservations.js";
import * as rooms from "../controllers/front-office/rooms.js";
import {
  foModel,
  mapTaxiForUi,
  normalizeTaxiPayload,
} from "../models/front-office/index.js";
import {
  guestCreateSchema,
  guestUpdateSchema,
  paymentCreateSchema,
  paymentUpdateSchema,
} from "../validators/front-office.js";
import {
  assertGuestContactUnique,
  getGuestByKey,
  sanitizeGuestInput,
} from "../services/front-office/guest-lookup.js";
import * as lostFoundItems from "../controllers/housekeeping/lost-found-items.js";

const router = Router();

// Dashboard
router.get("/dashboard", getDashboard);

// Reservations
router.get("/reservations/summary", reservations.getSummary);
router.get("/reservations/in-house", reservations.listInHouse);
router.get("/reservations/by-room/:roomId/current", reservations.getCurrentForRoom);
router.get("/reservations", reservations.listReservations);
router.get("/reservations/:id", reservations.getReservation);
router.post("/reservations", reservations.createReservation);
router.put("/reservations/:id", reservations.updateReservation);
router.patch("/reservations/:id", reservations.updateReservation);
router.delete("/reservations/:id", reservations.deleteReservation);
router.post("/reservations/:id/check-in", reservations.checkIn);
router.post("/reservations/:id/check-out", reservations.checkOut);
router.post("/reservations/:id/extend-stay", reservations.extendStay);

// Rooms
router.get("/rooms/availability", rooms.roomAvailability);
router.get("/rooms/blocks", rooms.listRoomBlocks);
router.get("/rooms/status", rooms.roomStatusCards);
router.get("/rooms", rooms.listRooms);
router.get("/rooms/:id", rooms.getRoom);
router.post("/rooms", rooms.createRoom);
router.put("/rooms/:id", rooms.updateRoom);
router.patch("/rooms/:id", rooms.updateRoom);

// Masters
mountCrud(
  router,
  "/masters/room-types",
  createCrudController({
    table: foModel.tables.roomTypes,
    idPrefix: "RT",
  }),
);
mountCrud(
  router,
  "/masters/tariff-plans",
  createCrudController({
    table: foModel.tables.tariffPlans,
    idPrefix: "TP",
  }),
);
mountCrud(
  router,
  "/masters/market-segments",
  createCrudController({
    table: foModel.tables.marketSegments,
    idPrefix: "MS",
  }),
);
mountCrud(
  router,
  "/masters/companies",
  createCrudController({
    table: foModel.tables.companies,
    idPrefix: "CO",
  }),
);
mountCrud(
  router,
  "/masters/booking-sources",
  createCrudController({
    table: foModel.tables.bookingSources,
    idPrefix: "BS",
  }),
);

// Guests
mountCrud(
  router,
  "/guests",
  createCrudController({
    table: foModel.tables.guests,
    idPrefix: "G",
    createSchema: guestCreateSchema,
    updateSchema: guestUpdateSchema,
    mapIncoming: sanitizeGuestInput,
    resolveId: async (key) => (await getGuestByKey(key))?.id ?? null,
    beforeCreate: async (body) => assertGuestContactUnique(body),
    beforeUpdate: async (id, body) => assertGuestContactUnique(body, id),
  }),
);
mountCrud(
  router,
  "/guest-stay-history",
  createCrudController({
    table: foModel.tables.guestStayHistory,
    idPrefix: "SH",
    listFilters: (req) => ({ guest_id: req.query.guestId as string | undefined }),
  }),
);

// Billing
mountCrud(
  router,
  "/folio",
  createCrudController({
    table: foModel.tables.folioEntries,
    idPrefix: "FE",
    listFilters: (req) => ({
      room: req.query.room as string | undefined,
      reservation_id: req.query.reservationId as string | undefined,
    }),
  }),
);
mountCrud(
  router,
  "/payments",
  createCrudController({
    table: foModel.tables.payments,
    idPrefix: "PAY",
    createSchema: paymentCreateSchema,
    updateSchema: paymentUpdateSchema,
  }),
);
mountCrud(
  router,
  "/invoices",
  createCrudController({
    table: foModel.tables.invoices,
    idPrefix: "INV",
  }),
);

// Ops services
mountCrud(
  router,
  "/transfers",
  createCrudController({
    table: foModel.tables.roomTransfers,
    idPrefix: "TR",
  }),
);
mountCrud(
  router,
  "/wake-up-calls",
  createCrudController({
    table: foModel.tables.wakeUpCalls,
    idPrefix: "WU",
  }),
);
mountCrud(
  router,
  "/taxi-bookings",
  createCrudController({
    table: foModel.tables.taxiBookings,
    idPrefix: "TX",
    mapIncoming: normalizeTaxiPayload,
    mapOutgoing: mapTaxiForUi,
  }),
);
mountCrud(
  router,
  "/luggage",
  createCrudController({
    table: foModel.tables.luggageItems,
    idPrefix: "LG",
  }),
);
mountCrud(
  router,
  "/messages",
  createCrudController({
    table: foModel.tables.messages,
    idPrefix: "MSG",
  }),
);
mountCrud(
  router,
  "/feedback",
  createCrudController({
    table: foModel.tables.guestFeedback,
    idPrefix: "FB",
  }),
);
router.get("/lost-found", lostFoundItems.listLostFoundItems);
router.get("/lost-found/:id", lostFoundItems.getLostFoundItem);
router.post("/lost-found", lostFoundItems.createLostFoundItem);
router.put("/lost-found/:id", lostFoundItems.updateLostFoundItem);
router.patch("/lost-found/:id", lostFoundItems.updateLostFoundItem);
router.post("/lost-found/:id/return", lostFoundItems.returnLostFoundItem);
router.post("/lost-found/:id/claim", lostFoundItems.claimLostFoundItem);
router.post("/lost-found/:id/dispose", lostFoundItems.disposeLostFoundItem);
router.post("/lost-found/:id/courier", lostFoundItems.courierLostFoundItem);
mountCrud(
  router,
  "/housekeeping-requests",
  createCrudController({
    table: foModel.tables.housekeepingRequests,
    idPrefix: "HK",
  }),
);
mountCrud(
  router,
  "/maintenance-requests",
  createCrudController({
    table: foModel.tables.maintenanceRequests,
    idPrefix: "MT",
  }),
);

// Closing
mountCrud(
  router,
  "/cashier-shifts",
  createCrudController({
    table: foModel.tables.cashierShifts,
    idPrefix: "CS",
  }),
);
mountCrud(
  router,
  "/room-charge-postings",
  createCrudController({
    table: foModel.tables.roomChargePostings,
    idPrefix: "RCP",
  }),
);
mountCrud(
  router,
  "/day-closing",
  createCrudController({
    table: foModel.tables.dayClosings,
    idPrefix: "DC",
  }),
);

// Reports
router.get("/reports/:type", getReport);

export default router;

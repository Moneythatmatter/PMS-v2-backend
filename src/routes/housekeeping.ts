import { Router } from "express";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { getDashboard } from "../controllers/housekeeping/dashboard.js";
import * as rooms from "../controllers/housekeeping/rooms.js";
import * as laundry from "../controllers/housekeeping/laundry.js";
import * as requisitions from "../controllers/housekeeping/requisitions.js";
import { getReport } from "../controllers/housekeeping/reports.js";
import { hkModel } from "../models/housekeeping/index.js";

const router = Router();

// Dashboard
router.get("/dashboard", getDashboard);

// Rooms (ops + CRUD)
router.get("/rooms", rooms.listRooms);
router.get("/rooms/:id", rooms.getRoom);
router.post("/rooms", rooms.createRoom);
router.put("/rooms/:id", rooms.updateRoom);
router.patch("/rooms/:id", rooms.updateRoom);
router.delete("/rooms/:id", rooms.deleteRoom);
router.post("/rooms/:id/start-clean", rooms.startClean);
router.post("/rooms/:id/pause-clean", rooms.pauseClean);
router.post("/rooms/:id/complete-clean", rooms.completeClean);
router.post("/rooms/:id/inspect", rooms.inspectRoom);
router.post("/rooms/:id/mark-dirty", rooms.markDirty);

// Laundry (ops + CRUD)
router.get("/laundry", laundry.listLaundry);
router.get("/laundry/:id", laundry.getLaundry);
router.post("/laundry", laundry.createLaundry);
router.put("/laundry/:id", laundry.updateLaundry);
router.patch("/laundry/:id", laundry.updateLaundry);
router.delete("/laundry/:id", laundry.deleteLaundry);
router.post("/laundry/:id/advance", laundry.advanceLaundry);

// Requisitions (ops + CRUD)
router.get("/requisitions", requisitions.listRequisitions);
router.get("/requisitions/:id", requisitions.getRequisition);
router.post("/requisitions", requisitions.createRequisition);
router.put("/requisitions/:id", requisitions.updateRequisition);
router.patch("/requisitions/:id", requisitions.updateRequisition);
router.delete("/requisitions/:id", requisitions.deleteRequisition);
router.post("/requisitions/:id/approve", requisitions.approveRequisition);
router.post("/requisitions/:id/issue", requisitions.issueRequisition);
router.post("/requisitions/:id/reject", requisitions.rejectRequisition);

// Public areas
mountCrud(
  router,
  "/public-areas",
  createTableCrud({
    table: hkModel.tables.publicAreas,
    idPrefix: "PA",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
      category: req.query.category as string | undefined,
      floor: req.query.floor as string | undefined,
    }),
  }),
);

// Checklist templates
mountCrud(
  router,
  "/checklists",
  createTableCrud({
    table: hkModel.tables.checklistTemplates,
    idPrefix: "CL",
  }),
);

// Staff
mountCrud(
  router,
  "/staff",
  createTableCrud({
    table: hkModel.tables.staff,
    idPrefix: "ST",
    listFilters: (req) => ({
      role: req.query.role as string | undefined,
      status: req.query.status as string | undefined,
    }),
  }),
);

// Shifts
mountCrud(
  router,
  "/shifts",
  createTableCrud({ table: hkModel.tables.shifts, idPrefix: "SH" }),
);

// Inventory
mountCrud(
  router,
  "/inventory",
  createTableCrud({
    table: hkModel.tables.inventory,
    idPrefix: "INV",
    listFilters: (req) => ({
      category: req.query.category as string | undefined,
    }),
  }),
);

// Damage reports
mountCrud(
  router,
  "/damage-reports",
  createTableCrud({
    table: hkModel.tables.damageReports,
    idPrefix: "DM",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
      room: req.query.room as string | undefined,
    }),
    orderBy: "id",
  }),
);

// History (read-heavy; create allowed for client logging)
mountCrud(
  router,
  "/history",
  createTableCrud({
    table: hkModel.tables.history,
    idPrefix: "H",
    listFilters: (req) => ({
      category: req.query.category as string | undefined,
      room: req.query.room as string | undefined,
    }),
    orderBy: "created_at",
  }),
);

// Luggage jobs (HK-owned; FO luggage_items remains for FO desk)
mountCrud(
  router,
  "/luggage",
  createTableCrud({
    table: hkModel.tables.luggageJobs,
    idPrefix: "LG",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
    }),
  }),
);

// Settings (key/value store; id = setting key)
mountCrud(
  router,
  "/settings",
  createTableCrud({ table: hkModel.tables.settings, idPrefix: "SET" }),
);

// Shared FO tables (guest requests / maintenance / lost & found)
mountCrud(
  router,
  "/guest-requests",
  createTableCrud({
    table: hkModel.shared.housekeepingRequests,
    idPrefix: "HKR",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
      room: req.query.room as string | undefined,
    }),
  }),
);

mountCrud(
  router,
  "/maintenance",
  createTableCrud({
    table: hkModel.shared.maintenanceRequests,
    idPrefix: "MNT",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
      room: req.query.room as string | undefined,
    }),
  }),
);

mountCrud(
  router,
  "/lost-found",
  createTableCrud({
    table: hkModel.shared.lostFoundItems,
    idPrefix: "LF",
    listFilters: (req) => ({
      status: req.query.status as string | undefined,
    }),
  }),
);

// Reports
router.get("/reports/:type", getReport);

export default router;

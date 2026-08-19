import { Router } from "express";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { getDashboard } from "../controllers/housekeeping/dashboard.js";
import * as rooms from "../controllers/housekeeping/rooms.js";
import * as tasks from "../controllers/housekeeping/tasks.js";
import * as guestRequests from "../controllers/housekeeping/guest-requests.js";
import * as maintenanceRequests from "../controllers/housekeeping/maintenance-requests.js";
import * as publicAreasMaster from "../controllers/housekeeping/public-areas-master.js";
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
// Housekeeping tasks (checkout → clean → approve flow)
router.get("/tasks", tasks.listTasks);
router.get("/tasks/room/:roomId/active", tasks.getActiveTaskForRoom);
router.get("/tasks/:id", tasks.getTask);
router.post("/tasks", tasks.createTask);
router.post("/tasks/:id/assign", tasks.assignTask);
router.post("/tasks/:id/start", tasks.startTask);
router.post("/tasks/:id/complete", tasks.completeTask);
router.post("/tasks/:id/approve", tasks.approveTask);
router.post("/tasks/:id/cancel", tasks.cancelTask);
// Guest service requests (slim ops — replaces legacy housekeeping_requests)
router.get("/guest-requests", guestRequests.listGuestRequests);
router.get("/guest-requests/:id", guestRequests.getGuestRequest);
router.post("/guest-requests", guestRequests.createGuestRequest);
router.put("/guest-requests/:id", guestRequests.updateGuestRequest);
router.patch("/guest-requests/:id", guestRequests.updateGuestRequest);
router.post("/guest-requests/:id/assign", guestRequests.assignGuestRequest);
router.post("/guest-requests/:id/start", guestRequests.startGuestRequest);
router.post("/guest-requests/:id/complete", guestRequests.completeGuestRequest);
router.post("/guest-requests/:id/cancel", guestRequests.cancelGuestRequest);
// Maintenance work orders (slim ops — replaces legacy maintenance_requests shape)
router.get("/maintenance", maintenanceRequests.listMaintenanceRequests);
router.get("/maintenance/:id", maintenanceRequests.getMaintenanceRequest);
router.post("/maintenance", maintenanceRequests.createMaintenanceRequest);
router.put("/maintenance/:id", maintenanceRequests.updateMaintenanceRequest);
router.patch("/maintenance/:id", maintenanceRequests.updateMaintenanceRequest);
router.post("/maintenance/:id/assign", maintenanceRequests.assignMaintenanceRequest);
router.post("/maintenance/:id/start", maintenanceRequests.startMaintenanceRequest);
router.post("/maintenance/:id/complete", maintenanceRequests.completeMaintenanceRequest);
router.post("/maintenance/:id/verify", maintenanceRequests.verifyMaintenanceRequest);
router.post("/maintenance/:id/cancel", maintenanceRequests.cancelMaintenanceRequest);
// Public areas master (inventory — separate from hk_public_areas ops)
router.get("/masters/public-areas", publicAreasMaster.listPublicAreasMaster);
router.get("/masters/public-areas/:id", publicAreasMaster.getPublicAreaMaster);
router.post("/masters/public-areas", publicAreasMaster.createPublicAreaMaster);
router.put("/masters/public-areas/:id", publicAreasMaster.updatePublicAreaMaster);
router.patch("/masters/public-areas/:id", publicAreasMaster.updatePublicAreaMaster);
router.delete("/masters/public-areas/:id", publicAreasMaster.deletePublicAreaMaster);
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
mountCrud(router, "/public-areas", createTableCrud({
    table: hkModel.tables.publicAreas,
    idPrefix: "PA",
    listFilters: (req) => ({
        status: req.query.status,
        category: req.query.category,
        floor: req.query.floor,
    }),
}));
// Checklist templates
mountCrud(router, "/checklists", createTableCrud({
    table: hkModel.tables.checklistTemplates,
    idPrefix: "CL",
}));
// Staff
mountCrud(router, "/staff", createTableCrud({
    table: hkModel.tables.staff,
    idPrefix: "ST",
    listFilters: (req) => ({
        role: req.query.role,
        status: req.query.status,
    }),
}));
// Shifts
mountCrud(router, "/shifts", createTableCrud({ table: hkModel.tables.shifts, idPrefix: "SH" }));
// Inventory
mountCrud(router, "/inventory", createTableCrud({
    table: hkModel.tables.inventory,
    idPrefix: "INV",
    listFilters: (req) => ({
        category: req.query.category,
    }),
}));
// Damage reports
mountCrud(router, "/damage-reports", createTableCrud({
    table: hkModel.tables.damageReports,
    idPrefix: "DM",
    listFilters: (req) => ({
        status: req.query.status,
        room: req.query.room,
    }),
    orderBy: "id",
}));
// History (read-heavy; create allowed for client logging)
mountCrud(router, "/history", createTableCrud({
    table: hkModel.tables.history,
    idPrefix: "H",
    listFilters: (req) => ({
        category: req.query.category,
        room: req.query.room,
    }),
    orderBy: "created_at",
}));
// Luggage jobs (HK-owned; FO luggage_items remains for FO desk)
mountCrud(router, "/luggage", createTableCrud({
    table: hkModel.tables.luggageJobs,
    idPrefix: "LG",
    listFilters: (req) => ({
        status: req.query.status,
        type: req.query.type,
    }),
}));
// Settings (key/value store; id = setting key)
mountCrud(router, "/settings", createTableCrud({ table: hkModel.tables.settings, idPrefix: "SET" }));
// Lost & found (shared FO table)
mountCrud(router, "/lost-found", createTableCrud({
    table: hkModel.shared.lostFoundItems,
    idPrefix: "LF",
    listFilters: (req) => ({
        status: req.query.status,
    }),
}));
// Reports
router.get("/reports/:type", getReport);
export default router;
//# sourceMappingURL=housekeeping.js.map
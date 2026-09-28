import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, } from "../front-office/base.js";
/** Prefixed HK tables (created by sql/housekeeping-schema.sql). */
export const hkTables = {
    rooms: "hk_rooms",
    tasks: "housekeeping_tasks",
    guestRequests: "guest_requests",
    publicAreasMaster: "public_areas",
    publicAreas: "hk_public_areas",
    checklistTemplates: "hk_checklist_templates",
    staff: "hk_staff",
    shifts: "hk_shifts",
    inventory: "hk_inventory",
    laundryJobs: "hk_laundry_jobs",
    laundryItems: "hk_laundry_items",
    laundryPricing: "hk_laundry_pricing",
    damageReports: "damage_reports",
    requisitions: "hk_requisitions",
    history: "hk_history",
    settings: "hk_settings",
};
/**
 * Shared FO tables reused by Housekeeping (already in front-office-schema.sql).
 * Prefer these over duplicating guest-facing ops data.
 */
export const hkSharedTables = {
    housekeepingRequests: "housekeeping_requests",
    maintenanceRequests: "maintenance_requests",
    lostFoundItems: "lost_found_items",
};
export const hkModel = {
    list: listRows,
    get: getRowById,
    create: insertRow,
    update: updateRow,
    remove: deleteRow,
    newId,
    newCode,
    tables: hkTables,
    shared: hkSharedTables,
};
//# sourceMappingURL=index.js.map
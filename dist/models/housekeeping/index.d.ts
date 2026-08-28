import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, type FilterMap } from "../front-office/base.js";
/** Prefixed HK tables (created by sql/housekeeping-schema.sql). */
export declare const hkTables: {
    readonly rooms: "hk_rooms";
    readonly tasks: "housekeeping_tasks";
    readonly guestRequests: "guest_requests";
    readonly publicAreasMaster: "public_areas";
    readonly publicAreas: "hk_public_areas";
    readonly checklistTemplates: "hk_checklist_templates";
    readonly staff: "hk_staff";
    readonly shifts: "hk_shifts";
    readonly inventory: "hk_inventory";
    readonly laundryJobs: "hk_laundry_jobs";
    readonly damageReports: "damage_reports";
    readonly requisitions: "hk_requisitions";
    readonly history: "hk_history";
    readonly luggageJobs: "hk_luggage_jobs";
    readonly settings: "hk_settings";
};
/**
 * Shared FO tables reused by Housekeeping (already in front-office-schema.sql).
 * Prefer these over duplicating guest-facing ops data.
 */
export declare const hkSharedTables: {
    readonly housekeepingRequests: "housekeeping_requests";
    readonly maintenanceRequests: "maintenance_requests";
    readonly luggageItems: "luggage_items";
    readonly lostFoundItems: "lost_found_items";
};
export type HkTableName = (typeof hkTables)[keyof typeof hkTables];
export declare const hkModel: {
    list: typeof listRows;
    get: typeof getRowById;
    create: typeof insertRow;
    update: typeof updateRow;
    remove: typeof deleteRow;
    newId: typeof newId;
    newCode: typeof newCode;
    tables: {
        readonly rooms: "hk_rooms";
        readonly tasks: "housekeeping_tasks";
        readonly guestRequests: "guest_requests";
        readonly publicAreasMaster: "public_areas";
        readonly publicAreas: "hk_public_areas";
        readonly checklistTemplates: "hk_checklist_templates";
        readonly staff: "hk_staff";
        readonly shifts: "hk_shifts";
        readonly inventory: "hk_inventory";
        readonly laundryJobs: "hk_laundry_jobs";
        readonly damageReports: "damage_reports";
        readonly requisitions: "hk_requisitions";
        readonly history: "hk_history";
        readonly luggageJobs: "hk_luggage_jobs";
        readonly settings: "hk_settings";
    };
    shared: {
        readonly housekeepingRequests: "housekeeping_requests";
        readonly maintenanceRequests: "maintenance_requests";
        readonly luggageItems: "luggage_items";
        readonly lostFoundItems: "lost_found_items";
    };
};
export type { FilterMap };

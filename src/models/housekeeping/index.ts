import {
  deleteRow,
  getRowById,
  insertRow,
  listRows,
  newCode,
  newId,
  updateRow,
  type FilterMap,
} from "../front-office/base.js";

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
  damageReports: "damage_reports",
  requisitions: "hk_requisitions",
  history: "hk_history",
  luggageJobs: "hk_luggage_jobs",
  settings: "hk_settings",
} as const;

/**
 * Shared FO tables reused by Housekeeping (already in front-office-schema.sql).
 * Prefer these over duplicating guest-facing ops data.
 */
export const hkSharedTables = {
  housekeepingRequests: "housekeeping_requests",
  maintenanceRequests: "maintenance_requests",
  luggageItems: "luggage_items",
  lostFoundItems: "lost_found_items",
} as const;

export type HkTableName = (typeof hkTables)[keyof typeof hkTables];

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

export type { FilterMap };

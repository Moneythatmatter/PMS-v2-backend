import { deleteRow, getRowById, insertRow, listRows, newCode, newId, updateRow, } from "../front-office/base.js";
export const mntTables = {
    assetCategories: "mnt_asset_categories",
    problemCategories: "mnt_problem_categories",
    rootCauses: "mnt_root_causes",
    pmTemplates: "mnt_pm_templates",
    vendors: "mnt_vendors",
    spareParts: "mnt_spare_parts",
    assets: "mnt_assets",
    requests: "mnt_requests",
    workOrders: "mnt_work_orders",
    pmSchedules: "mnt_pm_schedules",
    rooms: "mnt_rooms",
    publicAreas: "mnt_public_areas",
};
export const mntModel = {
    list: listRows,
    get: getRowById,
    create: insertRow,
    update: updateRow,
    remove: deleteRow,
    newId,
    newCode,
    tables: mntTables,
};
//# sourceMappingURL=index.js.map
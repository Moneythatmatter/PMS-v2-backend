import { hkModel } from "../../models/housekeeping/index.js";
import { fromError, ok } from "../../utils/response.js";
export async function getDashboard(_req, res) {
    try {
        const [rooms, laundry, requisitions, publicAreas, inventory, history] = await Promise.all([
            hkModel.list(hkModel.tables.rooms),
            hkModel.list(hkModel.tables.laundryJobs),
            hkModel.list(hkModel.tables.requisitions),
            hkModel.list(hkModel.tables.publicAreas),
            hkModel.list(hkModel.tables.inventory),
            hkModel.list(hkModel.tables.history, {
                orderBy: "id",
                ascending: false,
            }),
        ]);
        const dirtyRooms = rooms.filter((r) => ["Dirty", "Vacant Dirty", "Occupied Dirty"].includes(String(r.hkStatus ?? r.status)));
        const cleaning = rooms.filter((r) => String(r.hkStatus) === "Cleaning" || String(r.status) === "Cleaning");
        const inspectionPending = rooms.filter((r) => String(r.status) === "Inspection Pending" ||
            String(r.hkStatus) === "Inspected");
        const openLaundry = laundry.filter((j) => !["Delivered"].includes(String(j.status)));
        const pendingRequisitions = requisitions.filter((q) => String(q.status) === "Pending");
        const dirtyPublic = publicAreas.filter((a) => ["Dirty", "Assigned", "Cleaning"].includes(String(a.status)));
        return ok(res, {
            stats: [
                {
                    label: "Dirty Rooms",
                    value: dirtyRooms.length,
                    sublabel: "Awaiting clean",
                },
                {
                    label: "In Progress",
                    value: cleaning.length,
                    sublabel: "Being cleaned",
                },
                {
                    label: "Inspection Queue",
                    value: inspectionPending.length,
                    sublabel: "Supervisor check",
                },
                {
                    label: "Open Laundry",
                    value: openLaundry.length,
                    sublabel: "In pipeline",
                },
            ],
            dirtyRooms: dirtyRooms.slice(0, 12),
            cleaningRooms: cleaning.slice(0, 8),
            pendingRequisitions: pendingRequisitions.slice(0, 8),
            dirtyPublicAreas: dirtyPublic.slice(0, 8),
            openLaundry: openLaundry.slice(0, 8),
            inventoryAlerts: inventory
                .filter((i) => {
                const row = i;
                return Number(row.available ?? 0) < Number(row.parStock ?? 0);
            })
                .slice(0, 8),
            recentHistory: history.slice(0, 10),
        });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=dashboard.js.map
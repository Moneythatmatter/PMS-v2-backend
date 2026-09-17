import { smModel, smTables } from "../../models/sales-marketing/index.js";
import { fromError, ok } from "../../utils/response.js";
export async function getDashboard(_req, res) {
    try {
        const [leads, deals, bookings, activities] = await Promise.all([
            smModel.list(smTables.leads, { orderBy: "created_at" }),
            smModel.list(smTables.deals, { orderBy: "created_at" }),
            smModel.list(smTables.bookings, { orderBy: "created_at" }),
            smModel.list(smTables.activities, { orderBy: "activity_date" }),
        ]);
        const openDeals = deals.filter((d) => String(d.status) === "Open");
        const newLeads = leads.filter((l) => String(l.status) === "New");
        const tentativeBookings = bookings.filter((b) => String(b.status) === "Tentative");
        const confirmedBookings = bookings.filter((b) => String(b.status) === "Confirmed");
        const totalPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.dealValue ?? 0), 0);
        const totalContractValue = bookings.reduce((sum, b) => sum + Number(b.contractValue ?? 0), 0);
        return ok(res, {
            openDealsCount: openDeals.length,
            untouchedLeadsCount: newLeads.length,
            activeLeadsCount: leads.length,
            totalBookingsCount: bookings.length,
            tentativeBookingsCount: tentativeBookings.length,
            confirmedBookingsCount: confirmedBookings.length,
            totalPipelineValue,
            totalContractValue,
            recentActivities: activities.slice(0, 5),
            recentLeads: leads.slice(0, 5),
            recentBookings: bookings.slice(0, 5),
        });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=dashboard.js.map
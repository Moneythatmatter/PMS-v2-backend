import type { Request, Response } from "express";
import { smModel, smTables } from "../../models/sales-marketing/index.js";
import { fromError, ok } from "../../utils/response.js";

export async function getDashboard(_req: Request, res: Response) {
  try {
    const [leads, deals, bookings, activities] = await Promise.all([
      smModel.list(smTables.leads, { orderBy: "created_at" }),
      smModel.list(smTables.deals, { orderBy: "created_at" }),
      smModel.list(smTables.bookings, { orderBy: "created_at" }),
      smModel.list(smTables.activities, { orderBy: "activity_date" }),
    ]);

    const openDeals = deals.filter(
      (d) => String((d as Record<string, unknown>).status) === "Open",
    );
    const newLeads = leads.filter(
      (l) => String((l as Record<string, unknown>).status) === "New",
    );
    const tentativeBookings = bookings.filter(
      (b) => String((b as Record<string, unknown>).status) === "Tentative",
    );
    const confirmedBookings = bookings.filter(
      (b) => String((b as Record<string, unknown>).status) === "Confirmed",
    );

    const totalPipelineValue = openDeals.reduce<number>(
      (sum, d) => sum + Number((d as Record<string, unknown>).dealValue ?? 0),
      0,
    );
    const totalContractValue = bookings.reduce<number>(
      (sum, b) => sum + Number((b as Record<string, unknown>).contractValue ?? 0),
      0,
    );

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
  } catch (e) {
    return fromError(res, e);
  }
}

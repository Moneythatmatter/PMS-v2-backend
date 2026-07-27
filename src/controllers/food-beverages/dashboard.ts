import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { fromError, ok } from "../../utils/response.js";

type Order = Record<string, unknown>;
type LiveTable = Record<string, unknown>;
type Shift = Record<string, unknown>;

export async function getDashboard(req: Request, res: Response) {
  try {
    const outletId = req.query.outletId as string | undefined;
    const [outlets, tables, orders, shifts] = await Promise.all([
      fbModel.list(fbModel.tables.outlets),
      fbModel.list<LiveTable>(fbModel.tables.liveTables, {
        filters: outletId ? { outlet_id: outletId } : undefined,
      }),
      fbModel.list<Order>(fbModel.tables.orders, {
        filters: outletId ? { outlet_id: outletId } : undefined,
      }),
      fbModel.list<Shift>(fbModel.tables.cashierShifts, {
        filters: outletId ? { outlet_id: outletId } : undefined,
      }),
    ]);

    const occupied = tables.filter((t) =>
      ["Occupied", "Billing", "Reserved"].includes(String(t.status)),
    ).length;
    const openOrders = orders.filter((o) => o.status !== "Settled").length;
    const salesToday = orders.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    const openShifts = shifts.filter((s) => s.status === "Open").length;

    return ok(res, {
      outlets,
      stats: [
        {
          label: "Outlets",
          value: outlets.filter((o) =>
            ["restaurant", "cafe"].includes(String((o as { type?: string }).type)),
          ).length,
          sublabel: "Restaurants & cafes",
        },
        {
          label: "Tables Live",
          value: `${occupied}/${tables.length || 1}`,
          sublabel: "Occupied / total",
        },
        {
          label: "Open Orders",
          value: openOrders,
          sublabel: "In kitchen / service",
        },
        {
          label: "Sales Today",
          value: `₹${salesToday.toLocaleString("en-IN")}`,
          sublabel: `${openShifts} open shifts`,
        },
      ],
      recentOrders: orders.slice(0, 8),
      liveTables: tables.slice(0, 12),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

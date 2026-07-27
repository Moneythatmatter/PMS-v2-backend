import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Order = Record<string, unknown>;

const REPORT_TYPES = [
  "daily-sales",
  "item-sales",
  "category-sales",
  "outlet-sales",
  "cashier",
  "table-turnover",
  "food-cost",
  "inventory",
  "kitchen-performance",
  "cancelled-bills",
  "discount",
] as const;

export async function getReport(req: Request, res: Response) {
  try {
    const type = String(req.params.type);
    if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) {
      return fail(res, `Unknown report type: ${type}`, 404);
    }

    const [orders, outlets, ingredients, shifts, tables] = await Promise.all([
      fbModel.list<Order>(fbModel.tables.orders),
      fbModel.list(fbModel.tables.outlets),
      fbModel.list(fbModel.tables.ingredients),
      fbModel.list(fbModel.tables.cashierShifts),
      fbModel.list(fbModel.tables.liveTables),
    ]);

    const settled = orders.filter((o) => o.status === "Settled" || o.status === "Served");
    const salesTotal = settled.reduce((s, o) => s + Number(o.amount ?? 0), 0);

    const rows = (() => {
      switch (type) {
        case "daily-sales":
        case "outlet-sales":
          return outlets
            .filter((o) =>
              ["restaurant", "cafe", "bar"].includes(String((o as { type?: string }).type)),
            )
            .map((o) => {
              const outlet = o as Record<string, unknown>;
              const outletOrders = settled.filter((ord) => ord.outletId === outlet.id);
              const amount = outletOrders.reduce(
                (s, ord) => s + Number(ord.amount ?? 0),
                0,
              );
              return {
                id: outlet.id,
                outlet: outlet.name,
                orders: outletOrders.length,
                sales: amount,
                status: outlet.status,
              };
            });
        case "item-sales":
        case "category-sales": {
          const itemMap: Record<string, { qty: number; amount: number }> = {};
          for (const order of settled) {
            const lines = (order.lines as { name: string; qty: number }[]) ?? [];
            for (const line of lines) {
              if (!itemMap[line.name]) itemMap[line.name] = { qty: 0, amount: 0 };
              itemMap[line.name].qty += Number(line.qty ?? 0);
              itemMap[line.name].amount +=
                (Number(order.amount ?? 0) / Math.max(lines.length, 1));
            }
          }
          return Object.entries(itemMap).map(([name, v], i) => ({
            id: `ITEM-${i}`,
            item: name,
            qty: v.qty,
            sales: Math.round(v.amount),
            status: "Active",
          }));
        }
        case "cashier":
          return shifts;
        case "table-turnover":
          return tables.map((t) => {
            const table = t as Record<string, unknown>;
            return {
              id: table.id,
              table: table.tableNo,
              section: table.section,
              status: table.status,
              covers: table.covers,
              checkAmount: table.checkAmount,
            };
          });
        case "inventory":
        case "food-cost":
          return ingredients;
        case "kitchen-performance":
          return orders.map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            status: o.status,
            amount: o.amount,
            placedAt: o.placedAt,
            type: o.type,
          }));
        case "cancelled-bills":
          return orders.filter((o) => o.status === "Cancelled");
        case "discount":
          return [];
        default:
          return [];
      }
    })();

    return ok(res, {
      type,
      title: type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      summary: {
        salesTotal,
        orderCount: settled.length,
        outletCount: outlets.length,
      },
      rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

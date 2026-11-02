import type { Request, Response } from "express";
import { fbModel } from "../../models/food-beverages/index.js";
import { supabase } from "../../utils/supabase.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Order = Record<string, unknown>;
type Outlet = Record<string, unknown>;
type Ingredient = Record<string, unknown>;
type Shift = Record<string, unknown>;
type LiveTable = Record<string, unknown>;
type KdsTicket = Record<string, unknown>;

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

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "")
    .trim()
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!raw) return 0;
  const upper = raw.toUpperCase();
  if (upper.endsWith("L")) return (Number.parseFloat(upper) || 0) * 100_000;
  if (upper.endsWith("K")) return (Number.parseFloat(upper) || 0) * 1_000;
  return Number.parseFloat(upper) || 0;
}

function outletName(outlets: Outlet[], id: unknown) {
  const match = outlets.find((o) => o.id === id);
  return match ? String(match.name ?? id ?? "—") : String(id ?? "—");
}

function settledOrders(orders: Order[]) {
  return orders.filter((o) => {
    const s = String(o.status ?? "").toLowerCase();
    return s === "settled" || s === "served" || s === "closed" || s === "paid";
  });
}

function todayLabel() {
  return new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function orderDay(order: Order) {
  const raw = String(order.placedAt ?? order.createdAt ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toIsoDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function resolveRange(req: Request): { from: string; to: string; days: number } {
  const range = String(req.query.range ?? "7d");
  const to = startOfDay(new Date());
  const from = startOfDay(new Date());
  let days = 7;
  if (range === "today") days = 1;
  else if (range === "30d") days = 30;
  else if (range === "mtd") days = Math.max(1, to.getDate());
  else days = 7;
  from.setDate(to.getDate() - (days - 1));

  const fromQ = String(req.query.from ?? "");
  const toQ = String(req.query.to ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromQ) && /^\d{4}-\d{2}-\d{2}$/.test(toQ)) {
    return { from: fromQ, to: toQ, days: 0 };
  }
  return { from: toIsoDay(from), to: toIsoDay(to), days };
}

function inDateRange(isoDay: string, from: string, to: string) {
  return isoDay >= from && isoDay <= to;
}

/** Business date of a cashier session, else the Indian calendar day it opened. */
function shiftDay(s: Shift): string {
  if (s.businessDate) return String(s.businessDate).slice(0, 10);
  const opened = new Date(String(s.openedAt ?? ""));
  return Number.isNaN(opened.getTime()) ? "" : opened.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type SessionTotals = { cash: number; digital: number; total: number; variance: number | null };

/** Collections (payments tagged to each session) and counted variance per F&B cashier session. */
async function cashierTotals(shifts: Shift[]) {
  const ids = shifts.map((s) => String(s.id));
  const bySession = new Map<string, SessionTotals>();
  const names = new Map<string, string>();
  let cash = 0;
  let digital = 0;
  let variance = 0;
  if (!ids.length) return { bySession, names, cash, digital, variance };

  const [txns, recons, users] = await Promise.all([
    supabase
      .from("transactions")
      .select("fb_cashier_session_id, payment_method, amount, status, transaction_type")
      .in("fb_cashier_session_id", ids),
    supabase.from(fbModel.tables.cashierReconciliations).select("cashier_session_id, variance").in("cashier_session_id", ids),
    supabase.from("users").select("id, name, email").in("id", [...new Set(shifts.map((s) => String(s.cashierId ?? "")))]),
  ]);
  for (const u of (users.data ?? []) as Record<string, unknown>[]) names.set(String(u.id), String(u.name || u.email || "Unknown user"));

  for (const id of ids) bySession.set(id, { cash: 0, digital: 0, total: 0, variance: null });
  for (const t of (txns.data ?? []) as Record<string, unknown>[]) {
    const row = bySession.get(String(t.fb_cashier_session_id));
    if (!row || String(t.status) === "VOIDED" || String(t.status) === "FAILED" || String(t.status) === "PENDING") continue;
    const sign = String(t.transaction_type ?? "PAYMENT") === "PAYMENT" && String(t.status) === "COMPLETED" ? 1 : -1;
    const amount = sign * Number(t.amount ?? 0);
    if (String(t.payment_method ?? "").toUpperCase() === "CASH") row.cash += amount;
    else row.digital += amount;
    row.total += amount;
  }
  for (const r of (recons.data ?? []) as Record<string, unknown>[]) {
    if (r.variance == null) continue;
    const row = bySession.get(String(r.cashier_session_id));
    if (row) row.variance = (row.variance ?? 0) + Number(r.variance);
  }
  for (const row of bySession.values()) {
    cash += row.cash;
    digital += row.digital;
    variance += row.variance ?? 0;
  }
  return { bySession, names, cash, digital, variance };
}

function eachDay(from: string, to: string) {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    out.push(toIsoDay(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function getReport(req: Request, res: Response) {
  try {
    const type = String(req.params.type);
    if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) {
      return fail(res, `Unknown report type: ${type}`, 404);
    }

    const outletIdFilter = String(req.query.outletId ?? "").trim();
    const { from, to } = resolveRange(req);

    const [ordersAll, outletsAll, ingredients, shiftsAll, tablesAll, kdsAll] =
      await Promise.all([
        fbModel.list<Order>(fbModel.tables.orders),
        fbModel.list<Outlet>(fbModel.tables.outlets),
        fbModel.list<Ingredient>(fbModel.tables.ingredients),
        type === "cashier"
          ? fbModel
              .list<Shift>(fbModel.tables.cashierSessions, { orderBy: "opened_at", ascending: false })
              .catch(() => [] as Shift[])
          : Promise.resolve([] as Shift[]),
        fbModel.list<LiveTable>(fbModel.tables.liveTables),
        fbModel.list<KdsTicket>(fbModel.tables.kdsTickets),
      ]);

    const diningOutletsAll = outletsAll.filter((o) =>
      ["restaurant", "cafe", "bar"].includes(String(o.type ?? "")),
    );
    const diningOutlets = outletIdFilter
      ? diningOutletsAll.filter((o) => String(o.id) === outletIdFilter)
      : diningOutletsAll;
    const outlets = outletIdFilter
      ? outletsAll.filter((o) => String(o.id) === outletIdFilter)
      : outletsAll;

    const orders = ordersAll.filter((o) => {
      if (outletIdFilter && String(o.outletId) !== outletIdFilter) return false;
      return inDateRange(orderDay(o), from, to);
    });
    const settled = settledOrders(orders);
    const shifts = shiftsAll.filter((s) => {
      if (outletIdFilter && String(s.outletId) !== outletIdFilter) return false;
      return inDateRange(shiftDay(s), from, to);
    });
    const cashier = type === "cashier" ? await cashierTotals(shifts) : null;
    const tables = outletIdFilter
      ? tablesAll.filter((t) => String(t.outletId) === outletIdFilter)
      : tablesAll;
    const kds = outletIdFilter
      ? kdsAll.filter((t) => String(t.outletId) === outletIdFilter)
      : kdsAll;

    // Prefer live settled orders; fall back to outlet master sales when no bills yet
    const outletSalesFallback = (o: Outlet) => parseMoney(o.sales);
    const orderSalesByOutlet = (outletId: unknown) =>
      settled
        .filter((ord) => ord.outletId === outletId)
        .reduce((s, ord) => s + Number(ord.amount ?? 0), 0);

    const salesFromOrders = settled.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    const salesFromOutlets = diningOutlets.reduce(
      (s, o) => s + outletSalesFallback(o),
      0,
    );
    const salesTotal = salesFromOrders > 0 ? salesFromOrders : salesFromOutlets;
    const coversTotal =
      settled.reduce((s, o) => s + (Number(o.covers ?? 0) || 1), 0) ||
      diningOutlets.reduce((s, o) => s + Number(o.covers ?? 0), 0);

    const rows = (() => {
      switch (type) {
        case "daily-sales": {
          const byDay: Record<
            string,
            { bills: number; covers: number; sales: number }
          > = {};
          for (const day of eachDay(from, to)) {
            byDay[day] = { bills: 0, covers: 0, sales: 0 };
          }
          for (const o of settled) {
            const day = orderDay(o);
            if (!byDay[day]) byDay[day] = { bills: 0, covers: 0, sales: 0 };
            byDay[day].bills += 1;
            byDay[day].covers += Number(o.covers ?? 0) || 1;
            byDay[day].sales += Number(o.amount ?? 0);
          }
          const hasOrderSales = Object.values(byDay).some((v) => v.sales > 0);
          if (!hasOrderSales && salesFromOutlets > 0) {
            byDay[to] = {
              bills: 0,
              covers: coversTotal,
              sales: salesFromOutlets,
            };
          }
          const days = Object.entries(byDay).sort((a, b) =>
            a[0].localeCompare(b[0]),
          );
          return days.map(([date, v], i) => {
            const prev = days[i - 1]?.[1];
            const growth =
              prev && prev.sales > 0
                ? `${(((v.sales - prev.sales) / prev.sales) * 100).toFixed(1)}%`
                : "—";
            return {
              id: `DS-${date}`,
              date: formatDayLabel(date),
              isoDate: date,
              bills: v.bills,
              covers: v.covers,
              sales: inr(v.sales),
              salesValue: v.sales,
              avgCheck: inr(v.bills ? v.sales / v.bills : 0),
              growth,
            };
          });
        }

        case "outlet-sales":
          return diningOutlets.map((o) => {
            const fromOrders = orderSalesByOutlet(o.id);
            const amount =
              fromOrders > 0 ? fromOrders : outletSalesFallback(o);
            const outletOrders = settled.filter((ord) => ord.outletId === o.id);
            const bills =
              outletOrders.length ||
              (amount > 0 ? Math.max(1, Number(o.tables ?? 0) || 1) : 0);
            const covers =
              outletOrders.reduce(
                (s, ord) => s + (Number(ord.covers ?? 0) || 1),
                0,
              ) || Number(o.covers ?? 0);
            return {
              id: String(o.id),
              outlet: o.name,
              bills,
              covers,
              sales: inr(amount),
              salesValue: amount,
              avgCheck: inr(bills ? amount / bills : 0),
              growth: "—",
              status: o.status,
            };
          });

        case "item-sales": {
          const itemMap: Record<
            string,
            { category: string; qty: number; amount: number }
          > = {};
          for (const order of settled) {
            const lines =
              (order.lines as {
                name?: string;
                qty?: number;
                amount?: number;
                category?: string;
              }[]) ?? [];
            for (const line of lines) {
              const name = String(line.name ?? "Item");
              if (!itemMap[name]) {
                itemMap[name] = {
                  category: String(line.category ?? "General"),
                  qty: 0,
                  amount: 0,
                };
              }
              itemMap[name].qty += Number(line.qty ?? 0);
              itemMap[name].amount +=
                Number(line.amount ?? 0) ||
                Number(order.amount ?? 0) / Math.max(lines.length, 1);
            }
          }
          const total = Object.values(itemMap).reduce((s, v) => s + v.amount, 0);
          return Object.entries(itemMap)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([name, v], i) => ({
              id: `ITEM-${i}`,
              item: name,
              category: v.category,
              qty: v.qty,
              sales: inr(v.amount),
              share: total
                ? `${((v.amount / total) * 100).toFixed(1)}%`
                : "0%",
              status: "Active",
            }));
        }

        case "category-sales": {
          const catMap: Record<string, { qty: number; amount: number }> = {};
          for (const order of settled) {
            const lines =
              (order.lines as {
                name?: string;
                qty?: number;
                amount?: number;
                category?: string;
              }[]) ?? [];
            for (const line of lines) {
              const cat = String(line.category ?? "General");
              if (!catMap[cat]) catMap[cat] = { qty: 0, amount: 0 };
              catMap[cat].qty += Number(line.qty ?? 0);
              catMap[cat].amount +=
                Number(line.amount ?? 0) ||
                Number(order.amount ?? 0) / Math.max(lines.length, 1);
            }
          }
          const total = Object.values(catMap).reduce((s, v) => s + v.amount, 0);
          return Object.entries(catMap)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([category, v], i) => ({
              id: `CAT-${i}`,
              category,
              qty: v.qty,
              sales: inr(v.amount),
              share: total
                ? `${((v.amount / total) * 100).toFixed(1)}%`
                : "0%",
              growth: "—",
            }));
        }

        case "cashier":
          return shifts.map((s) => {
            const t = cashier!.bySession.get(String(s.id)) ?? { cash: 0, digital: 0, total: 0, variance: null };
            return {
              id: String(s.id),
              cashier: cashier!.names.get(String(s.cashierId)) ?? "Unknown cashier",
              outlet: outletName(outletsAll, s.outletId),
              outletId: s.outletId,
              shift: s.shiftName,
              opened: s.openedAt
                ? new Date(String(s.openedAt)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
                : "—",
              cash: inr(t.cash),
              digital: inr(t.digital),
              sales: inr(t.total),
              salesValue: t.total,
              variance: t.variance == null ? "—" : `${t.variance > 0 ? "+" : t.variance < 0 ? "−" : ""}${inr(Math.abs(t.variance))}`,
              status: s.status,
            };
          });

        case "table-turnover":
          return tables.map((t) => {
            const duration = Number(t.durationMin ?? 0);
            const turns =
              duration > 0 ? Math.max(1, Math.round(480 / duration)) : 1;
            const revenue = Number(t.checkAmount ?? 0);
            return {
              id: String(t.id),
              tableNo: t.tableNo,
              section: t.section ?? "—",
              turns,
              avgDuration: duration ? `${duration} min` : "—",
              revenue: inr(revenue),
              util: duration
                ? `${Math.min(100, Math.round((duration / 120) * 100))}%`
                : "—",
              status: t.status,
              outletId: t.outletId,
            };
          });

        case "food-cost": {
          const stockValue = ingredients.reduce(
            (s, i) => s + Number(i.onHand ?? 0) * 100,
            0,
          );
          return diningOutlets.map((o) => {
            const fromOrders = orderSalesByOutlet(o.id);
            const amount =
              fromOrders > 0 ? fromOrders : outletSalesFallback(o);
            const share =
              salesTotal > 0
                ? amount / salesTotal
                : 1 / Math.max(diningOutlets.length, 1);
            const cost = amount > 0 ? amount * 0.3 : stockValue * share * 0.3;
            const pct = amount > 0 ? (cost / amount) * 100 : 0;
            const target = 30;
            return {
              id: String(o.id),
              outlet: o.name,
              sales: inr(amount),
              cost: inr(cost),
              pct: `${pct.toFixed(1)}%`,
              target: `${target}%`,
              status: pct > target ? "Over" : "Under",
            };
          });
        }

        case "inventory": {
          const low = ingredients.filter(
            (i) => Number(i.onHand ?? 0) <= Number(i.reorder ?? 0),
          ).length;
          const value = ingredients.reduce(
            (s, i) => s + Number(i.onHand ?? 0) * 100,
            0,
          );
          return [
            {
              id: "STORE-MAIN",
              store: "Main Store",
              skus: ingredients.length,
              value: inr(value),
              lowStock: low,
              lastCount: todayLabel(),
              status: low ? "Attention" : "OK",
            },
          ];
        }

        case "kitchen-performance": {
          const kitchens = outlets.filter((o) => String(o.type) === "kitchen");
          const source = kitchens.length ? kitchens : diningOutlets;
          return source.map((k) => {
            const tickets = kds.filter((t) => t.outletId === k.id);
            const completed = tickets.filter((t) =>
              ["Ready", "Served", "Completed", "Done"].includes(
                String(t.status ?? ""),
              ),
            );
            const avg =
              tickets.length > 0
                ? tickets.reduce((s, t) => s + Number(t.elapsedMin ?? 0), 0) /
                  tickets.length
                : 0;
            const over = tickets.filter(
              (t) => Number(t.elapsedMin ?? 0) > Number(t.slaMin ?? 15),
            ).length;
            const sla =
              tickets.length > 0
                ? `${Math.round(((tickets.length - over) / tickets.length) * 100)}%`
                : "—";
            return {
              id: String(k.id),
              kitchen: k.name,
              tickets: completed.length || tickets.length,
              avgTime: avg ? `${Math.round(avg)} min` : "—",
              sla,
              overSla: over,
              outletId: k.id,
              status: k.status,
            };
          });
        }

        case "cancelled-bills":
          return orders
            .filter((o) =>
              ["Cancelled", "Void", "Voided"].includes(String(o.status ?? "")),
            )
            .map((o) => ({
              id: String(o.id),
              billNo: o.orderNo ?? o.id,
              outlet: outletName(outlets, o.outletId),
              outletId: o.outletId,
              amount: inr(Number(o.amount ?? 0)),
              reason: o.ref || o.guest || "Cancelled",
              approvedBy: o.server || "—",
              time: o.placedAt || "—",
              status: o.status,
            }));

        case "discount": {
          return settled
            .filter((o) => {
              const ref = String(o.ref ?? "").toLowerCase();
              return ref.includes("discount") || ref.includes("comp");
            })
            .map((o) => ({
              id: String(o.id),
              billNo: o.orderNo ?? o.id,
              outlet: outletName(outlets, o.outletId),
              outletId: o.outletId,
              gross: inr(Number(o.amount ?? 0)),
              discount: "—",
              reason: o.ref || "Discount",
              by: o.server || "—",
              status: o.status,
            }));
        }

        default:
          return [];
      }
    })();

    const billSum = (rows as Record<string, unknown>[]).reduce(
      (s, r) => s + (Number(r.bills ?? 0) || 0),
      0,
    );
    const coversSum = (rows as Record<string, unknown>[]).reduce(
      (s, r) => s + (Number(r.covers ?? 0) || 0),
      0,
    );
    const salesSum = (rows as Record<string, unknown>[]).reduce(
      (s, r) =>
        s +
        (Number(r.salesValue ?? 0) || parseMoney(r.sales) || parseMoney(r.amount) || parseMoney(r.revenue)),
      0,
    );
    const lastRow = (rows[rows.length - 1] ?? {}) as Record<string, unknown>;

    return ok(res, {
      type,
      title: type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      summary: {
        salesTotal: salesSum || salesTotal,
        salesLabel: inr(salesSum || salesTotal),
        orderCount: settled.length || billSum,
        coversTotal: coversSum || coversTotal,
        outletCount: diningOutlets.length,
        rowCount: rows.length,
        growth: String(lastRow.growth ?? "—"),
        from,
        to,
        outletId: outletIdFilter || null,
        ...(cashier
          ? {
              cashLabel: inr(cashier.cash),
              digitalLabel: inr(cashier.digital),
              varianceLabel: `${cashier.variance > 0 ? "+" : cashier.variance < 0 ? "−" : ""}${inr(Math.abs(cashier.variance))}`,
            }
          : {}),
      },
      rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

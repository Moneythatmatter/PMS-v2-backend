import { supabase } from "../../utils/supabase.js";
import { fbModel } from "../../models/food-beverages/index.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { addDays, currentBusinessDate } from "../front-office/business-date.js";
import { localTodayIso } from "../front-office/room-hk-status.js";
import { outletBySourceId } from "./fb-outlet-payments.js";

type Row = Record<string, unknown>;

/** Business dates are Indian calendar days; timestamps are stored in UTC. */
const PROPERTY_UTC_OFFSET = "+05:30";
const UNSETTLED_SHIFT = new Set(["Open", "Rejected", "Pending Approval"]);
const SETUP_HINT = "Run backend/sql/fb-cashier-day-close.sql in Supabase.";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export type FbDayCloseCheck = {
  id: string;
  label: string;
  mandatory: boolean;
  passed: boolean;
  detail: string;
  href?: string;
};

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dayStart = (d: string) => `${d}T00:00:00${PROPERTY_UTC_OFFSET}`;
const isRoomCharge = (mode: unknown) => /room/i.test(String(mode ?? ""));
const isOpenOrder = (o: Row) => String(o.lifecycleStatus ?? "OPEN").toUpperCase() === "OPEN";
const isUnpaidBill = (b: Row) =>
  String(b.paymentStatus ?? "UNPAID").toUpperCase() !== "PAID" &&
  !["CLOSED", "CANCELLED", "VOID", "VOIDED"].includes(String(b.status ?? "OPEN").toUpperCase());

function setupError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/fb_outlet_day_closings|fb_cashier_session/.test(message)) throw new AppError(`F&B day close is not set up yet. ${SETUP_HINT}`);
  throw e;
}

async function userName(id: string | undefined) {
  if (!id) return "Unknown user";
  const { data } = await supabase.from("users").select("name, email").eq("id", id).maybeSingle();
  return (data?.name as string) || (data?.email as string) || "Unknown user";
}

async function billsForOrders(orderIds: string[]): Promise<Row[]> {
  if (!orderIds.length) return [];
  const wanted = new Set(orderIds);
  const rows = await fbModel.list<Row>(fbModel.tables.bills);
  return rows.filter((b) => wanted.has(String(b.orderId)));
}

/** F&B payments on a business date, keyed to their outlet. */
async function paymentsOn(businessDate: string) {
  const propertyId = getActivePropertyId();
  let query = supabase
    .from("transactions")
    .select("id, source_id, payment_method, amount, status, transaction_type")
    .eq("source_module", "FNB")
    .gte("transaction_date", dayStart(businessDate))
    .lt("transaction_date", dayStart(addDays(businessDate, 1)));
  if (propertyId) query = query.eq("property_id", propertyId);
  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);
  const rows = (data ?? []) as Row[];
  const outlets = await outletBySourceId(rows.map((r) => String(r.source_id ?? "")));
  return rows.map((r): Row => ({ ...r, outletId: outlets.get(String(r.source_id ?? "")) ?? null }));
}

async function loadOutlet(outletIdInput: unknown) {
  const outletId = String(outletIdInput ?? "").trim();
  if (!outletId) throw new AppError("Select the outlet");
  const outlet = await fbModel.get<Row>(fbModel.tables.outlets, outletId);
  if (!outlet) throw new AppError("Outlet not found", 404);
  return outlet;
}

export const FbDayCloseService = {
  async status(outletIdInput: unknown) {
    if (!getActivePropertyId()) throw new AppError("Select a property first");
    const outlet = await loadOutlet(outletIdInput);
    const outletId = String(outlet.id);
    const { businessDate } = await currentBusinessDate();
    const today = localTodayIso();
    const from = dayStart(businessDate);
    const to = dayStart(addDays(businessDate, 1));

    const [closings, sessions, orders, payments] = await Promise.all([
      fbModel
        .list<Row>(fbModel.tables.outletDayClosings, { filters: { outlet_id: outletId, business_date: businessDate }, limit: 1 })
        .catch(setupError),
      fbModel.list<Row>(fbModel.tables.cashierSessions, { filters: { outlet_id: outletId } }).catch(setupError),
      fbModel.list<Row>(fbModel.tables.orders, { filters: { outlet_id: outletId } }),
      paymentsOn(businessDate),
    ]);
    const bills = await billsForOrders(orders.map((o) => String(o.id)));
    const orderById = new Map(orders.map((o) => [String(o.id), o]));

    const unsettled = sessions.filter((s) => UNSETTLED_SHIFT.has(String(s.status)));
    const names = new Map<string, string>();
    const ids = [...new Set(unsettled.map((s) => String(s.cashierId ?? "")).filter(Boolean))];
    if (ids.length) {
      const { data } = await supabase.from("users").select("id, name, email").in("id", ids);
      for (const u of (data ?? []) as Row[]) names.set(String(u.id), String(u.name || u.email || "Unknown user"));
    }
    const shiftList = unsettled.map((s) => ({
      id: String(s.id),
      cashierName: names.get(String(s.cashierId)) ?? "Unknown cashier",
      shiftName: String(s.shiftName ?? ""),
      openedAt: String(s.openedAt ?? ""),
      status: String(s.status),
    }));
    const openShifts = shiftList.filter((s) => s.status !== "Pending Approval");
    const awaitingApproval = shiftList.filter((s) => s.status === "Pending Approval");
    const openOrders = orders.filter(isOpenOrder);
    const unpaidBills = bills.filter(isUnpaidBill);

    const dayBills = bills.filter((b) => {
      const at = new Date(String(b.createdAt ?? "")).getTime();
      return at >= new Date(from).getTime() && at < new Date(to).getTime() && !["CANCELLED", "VOID", "VOIDED"].includes(String(b.status ?? "").toUpperCase());
    });
    let grossSales = 0;
    let discount = 0;
    let tax = 0;
    let netSales = 0;
    let roomCharges = 0;
    for (const b of dayBills) {
      grossSales += num(b.subtotal);
      discount += num(b.discount);
      tax += num(b.tax);
      netSales += num(b.total);
      if (isRoomCharge(orderById.get(String(b.orderId))?.paymentMode)) roomCharges += num(b.total);
    }

    const byMethod = new Map<string, number>();
    let refunds = 0;
    for (const p of payments) {
      if (p.outletId !== outletId) continue;
      const status = String(p.status ?? "");
      if (status !== "COMPLETED" && status !== "REFUNDED") continue;
      const type = String(p.transaction_type ?? "PAYMENT");
      if (type === "REFUND") {
        refunds += num(p.amount);
        continue;
      }
      if (type !== "PAYMENT") continue;
      const method = METHOD_LABELS[String(p.payment_method)] ? String(p.payment_method) : "OTHER";
      byMethod.set(method, (byMethod.get(method) ?? 0) + num(p.amount));
    }
    const collected = [...byMethod.values()].reduce((a, b) => a + b, 0);

    const checks: FbDayCloseCheck[] = [
      {
        id: "cashier",
        label: "All cashier shifts closed",
        mandatory: true,
        passed: openShifts.length === 0,
        detail: openShifts.length ? `${plural(openShifts.length, "shift")} still open` : "No open shifts",
        href: "/food-beverages/restaurants/cashier",
      },
      {
        id: "approvals",
        label: "Cashier closings approved",
        mandatory: true,
        passed: awaitingApproval.length === 0,
        detail: awaitingApproval.length ? `${plural(awaitingApproval.length, "closing")} awaiting approval` : "Nothing awaiting approval",
        href: "/food-beverages/restaurants/cashier/history",
      },
      {
        id: "orders",
        label: "Open orders closed",
        mandatory: true,
        passed: openOrders.length === 0,
        detail: openOrders.length ? `${plural(openOrders.length, "order")} still open` : "All orders settled or cancelled",
        href: "/food-beverages/restaurants/orders",
      },
      {
        id: "bills",
        label: "Bills settled",
        mandatory: true,
        passed: unpaidBills.length === 0,
        detail: unpaidBills.length ? `${plural(unpaidBills.length, "bill")} not fully paid` : "No unpaid bills",
        href: "/food-beverages/restaurants/bills",
      },
    ];

    const closing = closings[0] ?? null;
    return {
      businessDate,
      calendarDate: today,
      outlet: { id: outletId, name: String(outlet.name ?? outletId), type: String(outlet.type ?? "") },
      closed: Boolean(closing),
      closing,
      canClose: !closing && businessDate <= today,
      checks,
      blockers: checks.filter((c) => c.mandatory && !c.passed).length,
      unsettledShifts: shiftList,
      openOrders: openOrders.slice(0, 20).map((o) => ({
        id: String(o.id),
        orderNo: String(o.orderNo ?? o.id),
        type: String(o.type ?? ""),
        ref: String(o.ref ?? ""),
        status: String(o.status ?? ""),
        amount: num(o.amount),
      })),
      unpaidBills: unpaidBills.slice(0, 20).map((b) => ({
        id: String(b.id),
        billNo: String(b.billNo ?? b.id),
        total: num(b.total),
        paymentStatus: String(b.paymentStatus ?? "UNPAID"),
      })),
      totals: {
        billsCount: dayBills.length,
        grossSales: round2(grossSales),
        discount: round2(discount),
        tax: round2(tax),
        netSales: round2(netSales),
        roomCharges: round2(roomCharges),
        collections: {
          byMethod: Object.keys(METHOD_LABELS).map((key) => ({ method: key, label: METHOD_LABELS[key], amount: round2(byMethod.get(key) ?? 0) })),
          gross: round2(collected),
          refunds: round2(refunds),
          net: round2(collected - refunds),
        },
      },
    };
  },

  async run(outletIdInput: unknown) {
    const status = await this.status(outletIdInput);
    if (status.closed) throw new AppError(`${status.outlet.name} is already closed for ${status.businessDate}.`, 409);
    if (!status.canClose) throw new AppError("This business date is in the future. Run day close on that date.", 409);
    if (status.blockers > 0) {
      const pending = status.checks.filter((c) => c.mandatory && !c.passed).map((c) => c.label);
      throw new AppError(`Resolve mandatory checks first: ${pending.join(", ")}`, 409);
    }
    const userId = getRequestStore()?.userId;
    const t = status.totals;
    return fbModel
      .create<Row>(fbModel.tables.outletDayClosings, {
        outletId: status.outlet.id,
        businessDate: status.businessDate,
        billsCount: t.billsCount,
        grossSales: t.grossSales,
        discount: t.discount,
        tax: t.tax,
        netSales: t.netSales,
        roomCharges: t.roomCharges,
        collections: t.collections.net,
        summary: { checks: status.checks, collections: t.collections },
        closedAt: new Date().toISOString(),
        closedBy: userId ?? null,
        closedByName: await userName(userId),
      })
      .catch((e: unknown) => {
        if (/duplicate|unique/i.test(e instanceof Error ? e.message : "")) {
          throw new AppError(`${status.outlet.name} is already closed for ${status.businessDate}.`, 409);
        }
        return setupError(e);
      });
  },

  async history(outletId?: string, limit = 30) {
    const rows = await fbModel
      .list<Row>(fbModel.tables.outletDayClosings, {
        filters: outletId ? { outlet_id: outletId } : undefined,
        orderBy: "business_date",
        ascending: false,
        limit,
      })
      .catch(setupError);
    const outlets = await fbModel.list<Row>(fbModel.tables.outlets).catch(() => [] as Row[]);
    const names = new Map(outlets.map((o) => [String(o.id), String(o.name ?? o.id)]));
    return rows.map((r) => ({ ...r, outletName: names.get(String(r.outletId)) ?? null }));
  },

  /**
   * Outlets with F&B activity on the business date (open shifts, open orders or bills raised that day)
   * that have not run their day close. Empty when the F&B tables are not set up.
   */
  async outletsNotClosed(businessDate: string): Promise<{ id: string; name: string }[]> {
    try {
      const [closings, sessions, orders, outlets] = await Promise.all([
        fbModel.list<Row>(fbModel.tables.outletDayClosings, { filters: { business_date: businessDate } }),
        fbModel.list<Row>(fbModel.tables.cashierSessions),
        fbModel.list<Row>(fbModel.tables.orders),
        fbModel.list<Row>(fbModel.tables.outlets),
      ]);
      const closed = new Set(closings.map((c) => String(c.outletId)));
      const active = new Set<string>();
      for (const s of sessions) if (UNSETTLED_SHIFT.has(String(s.status)) || s.businessDate === businessDate) active.add(String(s.outletId));
      for (const o of orders) if (isOpenOrder(o)) active.add(String(o.outletId));
      const from = new Date(dayStart(businessDate)).getTime();
      const to = new Date(dayStart(addDays(businessDate, 1))).getTime();
      const orderOutlet = new Map(orders.map((o) => [String(o.id), String(o.outletId)]));
      const bills = await fbModel.list<Row>(fbModel.tables.bills);
      for (const b of bills) {
        const at = new Date(String(b.createdAt ?? "")).getTime();
        if (at >= from && at < to) {
          const outlet = orderOutlet.get(String(b.orderId));
          if (outlet) active.add(outlet);
        }
      }
      const names = new Map(outlets.map((o) => [String(o.id), String(o.name ?? o.id)]));
      return [...active].filter((id) => !closed.has(id) && names.has(id)).map((id) => ({ id, name: names.get(id)! }));
    } catch {
      return [];
    }
  },
};

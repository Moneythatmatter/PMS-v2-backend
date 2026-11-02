import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId, getRequestStore } from "../../utils/request-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors/index.js";
import { accTables, list, update, type Row } from "../../models/accounts/repo.js";
import { TransactionService } from "../shared/transaction.service.js";
import type { BillableCompany } from "../shared/company-party.service.js";
import { currentBusinessDate } from "./business-date.js";

const TABLE = "fo_company_bills";
const PHASE2 = "Run backend/sql/accounts-fo-posting-phase2.sql in Supabase.";
const PHASE3 = "Run backend/sql/accounts-fo-posting-phase3.sql in Supabase.";

const round2 = (n: number) => Math.round(n * 100) / 100;

function pid(): string {
  const id = getActivePropertyId();
  if (!id) throw new ValidationError("X-Property-Id is required");
  return id;
}

function schemaError(message: string): never {
  if (/group_id|folio_id|transfer_transaction_id|void_reason|voided_|acc_void_voucher_id/i.test(message)) {
    throw new ValidationError(`Company bills need the latest setup. ${PHASE3}`);
  }
  if (/fo_company_bills|does not exist|schema cache/i.test(message)) {
    throw new ValidationError(`Bill to company is not set up. ${PHASE2}`);
  }
  throw new Error(message);
}

/** Fails early (before checkout or any other change) when the table or phase 3 columns are missing. */
export async function assertCompanyBillsReady(): Promise<void> {
  const { error } = await supabase.from(TABLE).select("id, group_id, transfer_transaction_id, acc_void_voucher_id").limit(1);
  if (error) schemaError(error.message);
}

/**
 * Bill part of a folio to a company. The amount leaves the folio as a transfer entry
 * (so the folio balance drops) and is posted to the company's receivable by Night Audit.
 */
export async function createCompanyBill(input: {
  company: BillableCompany;
  amount: number;
  folioId: string;
  reservationId?: string | null;
  groupId?: string | null;
  notes?: string;
}): Promise<Row> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new ValidationError("Bill to company amount must be more than zero");
  const { businessDate } = await currentBusinessDate();
  const createdBy = getRequestStore()?.userId ?? null;
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      property_id: pid(),
      bill_no: foModel.newCode("CB"),
      reservation_id: input.reservationId ?? null,
      group_id: input.groupId ?? null,
      folio_id: input.folioId,
      company_id: input.company.companyId,
      party_id: input.company.partyId,
      amount,
      business_date: businessDate,
      notes: input.notes ?? "",
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) schemaError(error.message);
  const bill = data as Row;

  const txn = await TransactionService.recordViaRpc({
    amount,
    transactionType: "PAYMENT",
    paymentMethod: "OTHER",
    folioId: input.folioId,
    bookingId: input.reservationId ?? null,
    sourceModule: "ACCOUNTS",
    sourceType: "COMPANY_BILL",
    sourceId: String(bill.id),
    externalReference: String(bill.bill_no),
    notes: `Billed to ${input.company.companyName} — ${String(bill.bill_no)}`,
  });
  const { error: linkErr } = await supabase
    .from(TABLE)
    .update({ transfer_transaction_id: txn.id })
    .eq("id", bill.id);
  if (linkErr) throw new Error(linkErr.message);
  return { ...bill, transfer_transaction_id: txn.id };
}

async function byIds(table: string, ids: string[], select: string): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from(table).select(select).in("id", unique);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as unknown as Row[]).map((r) => [String(r.id), r]));
}

export const CompanyBillService = {
  /** Company bills with company, stay / group, voucher and receivable-bill details. */
  async list(query: { status?: string; from?: string; to?: string } = {}) {
    let q = supabase.from(TABLE).select("*").eq("property_id", pid());
    if (query.status === "Open" || query.status === "Void") q = q.eq("status", query.status);
    if (query.from) q = q.gte("business_date", query.from);
    if (query.to) q = q.lte("business_date", query.to);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) schemaError(error.message);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return [];

    const [parties, reservations, groups, vouchers, arBills] = await Promise.all([
      byIds(accTables.parties, rows.map((r) => String(r.party_id ?? "")), "id, party_name"),
      byIds(foModel.tables.reservations, rows.map((r) => String(r.reservation_id ?? "")), "id, booking_no, guest_name"),
      byIds(foModel.tables.foGroups, rows.map((r) => String(r.group_id ?? "")), "id, group_no, group_name"),
      byIds(
        accTables.vouchers,
        rows.flatMap((r) => [String(r.acc_voucher_id ?? ""), String(r.acc_void_voucher_id ?? "")]),
        "id, voucher_no, status",
      ),
      list(accTables.partyBills, { in: { bill_no: rows.map((r) => String(r.bill_no)) }, select: "id,bill_no,party_id,status" }),
    ]);
    const settlements = arBills.length
      ? await list(accTables.billSettlements, { in: { bill_id: arBills.map((b) => String(b.id)) }, select: "bill_id,amount,deductions" })
      : [];
    const settledBy = new Map<string, number>();
    for (const s of settlements) {
      settledBy.set(String(s.billId), round2((settledBy.get(String(s.billId)) ?? 0) + Number(s.amount ?? 0) + Number(s.deductions ?? 0)));
    }

    return rows.map((r) => {
      const res = reservations.get(String(r.reservation_id ?? ""));
      const grp = groups.get(String(r.group_id ?? ""));
      const voucher = vouchers.get(String(r.acc_voucher_id ?? ""));
      const voidVoucher = vouchers.get(String(r.acc_void_voucher_id ?? ""));
      const ar = arBills.find((b) => String(b.billNo) === String(r.bill_no) && String(b.partyId) === String(r.party_id));
      return {
        ...toCamel<Row>(r),
        amount: Number(r.amount ?? 0),
        partyName: parties.get(String(r.party_id))?.party_name ?? null,
        bookingNo: res?.booking_no ?? null,
        guestName: res?.guest_name ?? null,
        groupNo: grp?.group_no ?? null,
        groupName: grp?.group_name ?? null,
        voucherNo: voucher?.voucher_no ?? null,
        voucherStatus: voucher?.status ?? null,
        voidVoucherNo: voidVoucher?.voucher_no ?? null,
        arBillStatus: ar?.status ?? null,
        settledAmount: ar ? settledBy.get(String(ar.id)) ?? 0 : 0,
      };
    });
  },

  /**
   * Void a company bill: the amount goes back on the folio. If it was already posted, its
   * receivable bill is cancelled and the next Front Office posting reverses the entry.
   */
  async void(id: string, reasonInput: unknown) {
    const reason = String(reasonInput ?? "").trim();
    if (!reason) throw new ValidationError("A reason is required");
    await assertCompanyBillsReady();
    const { data, error } = await supabase.from(TABLE).select("*").eq("property_id", pid()).eq("id", id).maybeSingle();
    if (error) schemaError(error.message);
    const bill = data as Row | null;
    if (!bill) throw new NotFoundError("Company bill not found");
    if (bill.status === "Void") throw new ConflictError("Company bill is already void");

    if (bill.acc_voucher_id) {
      const vouchers = await byIds(accTables.vouchers, [String(bill.acc_voucher_id)], "id, voucher_no, status");
      const voucher = vouchers.get(String(bill.acc_voucher_id));
      if (voucher?.status === "Draft") {
        throw new ConflictError(
          `This bill is in Front Office draft voucher ${String(voucher.voucher_no)} — post or delete that voucher first`,
        );
      }
      const arBills = await list(accTables.partyBills, {
        eq: { party_id: bill.party_id, bill_no: bill.bill_no },
        select: "id,status",
      });
      for (const ar of arBills.filter((b) => b.status !== "Cancelled")) {
        const settled = await list(accTables.billSettlements, { eq: { bill_id: ar.id }, select: "id" });
        if (settled.length) {
          throw new ConflictError("The company has paid against this bill in Accounts — remove those settlements first");
        }
      }
      for (const ar of arBills.filter((b) => b.status !== "Cancelled")) {
        await update(accTables.partyBills, String(ar.id), { status: "Cancelled", remarks: `Company bill voided: ${reason}` });
      }
    }

    if (bill.transfer_transaction_id) {
      const { error: txnErr } = await supabase
        .from(foModel.tables.transactions)
        .update({ status: "VOIDED" })
        .eq("id", String(bill.transfer_transaction_id));
      if (txnErr) throw new Error(txnErr.message);
    }

    const { error: updErr } = await supabase
      .from(TABLE)
      .update({
        status: "Void",
        void_reason: reason,
        voided_at: new Date().toISOString(),
        voided_by: getRequestStore()?.userId ?? null,
      })
      .eq("id", id)
      .eq("status", "Open");
    if (updErr) schemaError(updErr.message);
    return { id, status: "Void" };
  },
};

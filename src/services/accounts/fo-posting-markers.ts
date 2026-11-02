import { supabase } from "../../utils/supabase.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError } from "../../errors/index.js";
import { accTables, list, num, update, type Row } from "../../models/accounts/repo.js";
import { createBillForVoucher } from "./bills.service.js";

export const FO_SOURCE_MODULE = "Front Office";
export const FB_SOURCE_MODULE = "F&B";

/** Make the bills / payments of a deleted or reversed F&B voucher postable again. */
export async function releaseFbPostingMarkers(voucherId: string): Promise<void> {
  const propertyId = getActivePropertyId();
  if (!propertyId) return;
  const release = (table: string, column: string) =>
    supabase.from(table).update({ [column]: null }).eq("property_id", propertyId).eq(column, voucherId);
  const updates = [
    release("fb_bills", "acc_voucher_id"),
    release("transactions", "acc_voucher_id"),
    release("transactions", "acc_void_voucher_id"),
  ];
  for (const { error } of await Promise.all(updates)) {
    if (error && !/acc_voucher_id|acc_void_voucher_id|does not exist|schema cache/i.test(error.message)) {
      throw new AppError(`Could not release F&B postings: ${error.message}`, 500);
    }
  }
}

/** Make the charges / payments of a deleted or reversed Front Office voucher postable again. */
export async function releaseFoPostingMarkers(voucherId: string): Promise<void> {
  const propertyId = getActivePropertyId();
  if (!propertyId) return;
  const release = (table: string, column: string) =>
    supabase.from(table).update({ [column]: null }).eq("property_id", propertyId).eq(column, voucherId);
  const updates = [
    release("folio_charges", "acc_voucher_id"),
    release("transactions", "acc_voucher_id"),
    release("transactions", "acc_adjust_voucher_id"),
    release("transactions", "acc_void_voucher_id"),
    release("fo_company_bills", "acc_voucher_id"),
    release("fo_company_bills", "acc_void_voucher_id"),
  ];
  for (const { error } of await Promise.all(updates)) {
    if (error && !/acc_void_voucher_id|fo_company_bills|does not exist|schema cache/i.test(error.message)) {
      throw new AppError(`Could not release Front Office postings: ${error.message}`, 500);
    }
  }
}

/** Raise a receivable bill in the party's ledger for each company bill posted by a Front Office voucher. */
export async function raiseFoCompanyBills(voucher: Row): Promise<void> {
  const propertyId = getActivePropertyId();
  if (!propertyId) return;
  const { data, error } = await supabase
    .from("fo_company_bills")
    .select("*")
    .eq("property_id", propertyId)
    .eq("acc_voucher_id", voucher.id)
    .eq("status", "Open");
  if (error) {
    if (/fo_company_bills|does not exist|schema cache/i.test(error.message)) return;
    throw new AppError(`Could not read company bills: ${error.message}`, 500);
  }
  for (const b of (data ?? []) as Row[]) {
    const billNo = String(b.bill_no);
    const existing = await list(accTables.partyBills, { eq: { party_id: b.party_id, bill_no: billNo }, limit: 1 });
    const details = b.group_id
      ? `Group master folio transferred (group ${b.group_id})`
      : `Guest bill transferred at checkout${b.reservation_id ? ` (reservation ${b.reservation_id})` : ""}`;
    if (existing[0]) {
      if (existing[0].status === "Cancelled") {
        await update(accTables.partyBills, existing[0].id, {
          status: "Open",
          voucherId: voucher.id,
          amount: num(b.amount),
          remarks: "",
        });
      }
      continue;
    }
    await createBillForVoucher(
      voucher,
      {
        moduleType: "AR",
        billNo,
        billDate: String(b.business_date).slice(0, 10),
        amount: num(b.amount),
        details,
        partyId: String(b.party_id),
      },
      num(b.amount),
    );
  }
}

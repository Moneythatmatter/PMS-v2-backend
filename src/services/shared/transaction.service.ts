import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { foModel } from "../../models/front-office/index.js";
import type {
  RecordTransactionInput,
  Transaction,
} from "../../types/transactions.js";
import { AppError } from "../../errors/index.js";

function normalizePaymentMethod(mode?: string): string {
  const m = String(mode ?? "CASH").trim().toUpperCase();
  if (["CASH", "CARD", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"].includes(m)) {
    return m;
  }
  if (/card|credit|debit/i.test(m)) return "CARD";
  if (/upi|gpay|phonepe|paytm/i.test(m)) return "UPI";
  if (/bank|neft|rtgs|imps/i.test(m)) return "BANK_TRANSFER";
  if (/cheque|check/i.test(m)) return "CHEQUE";
  return "OTHER";
}

/**
 * Cross-module payment ledger — FO checkout, reservation advance, F&B orders, etc.
 */
export const TransactionService = {
  async list(filters: {
    bookingId?: string;
    folioId?: string;
    guestId?: string;
    sourceModule?: string;
    sourceId?: string;
    status?: string;
  } = {}): Promise<Transaction[]> {
    return foModel.list<Transaction>(foModel.tables.transactions, {
      filters: {
        booking_id: filters.bookingId,
        folio_id: filters.folioId,
        guest_id: filters.guestId,
        source_module: filters.sourceModule,
        source_id: filters.sourceId,
        status: filters.status,
      },
      orderBy: "transaction_date",
      ascending: false,
    });
  },

  async get(id: string): Promise<Transaction | null> {
    return foModel.get<Transaction>(foModel.tables.transactions, id);
  },

  async create(input: RecordTransactionInput): Promise<Transaction> {
    if (!(Number(input.amount) >= 0)) {
      throw new AppError("Transaction amount must be >= 0");
    }

    const row = await foModel.create<Transaction>(foModel.tables.transactions, {
      transactionType: input.transactionType ?? "PAYMENT",
      paymentMethod: input.paymentMethod ?? "CASH",
      amount: Number(input.amount),
      currency: input.currency ?? "INR",
      status: input.status ?? "COMPLETED",
      folioId: input.folioId ?? null,
      bookingId: input.bookingId ?? null,
      guestId: input.guestId ?? null,
      sourceModule: input.sourceModule ?? null,
      sourceId: input.sourceId ?? null,
      externalReference: input.externalReference ?? null,
      receivedBy: input.receivedBy ?? null,
      transactionDate: input.transactionDate ?? new Date().toISOString(),
      notes: input.notes ?? null,
    });

    return row;
  },

  /** Postgres RPC — auto transaction_number + single atomic insert. */
  async recordViaRpc(input: RecordTransactionInput): Promise<Transaction> {
    if (!(Number(input.amount) >= 0)) {
      throw new AppError("Transaction amount must be >= 0");
    }

    const { data, error } = await supabase.rpc("record_transaction", {
      p_amount: Number(input.amount),
      p_transaction_type: input.transactionType ?? "PAYMENT",
      p_payment_method: input.paymentMethod ?? "CASH",
      p_currency: input.currency ?? "INR",
      p_status: input.status ?? "COMPLETED",
      p_folio_id: input.folioId ?? null,
      p_booking_id: input.bookingId ?? null,
      p_guest_id: input.guestId ?? null,
      p_source_module: input.sourceModule ?? null,
      p_source_id: input.sourceId ?? null,
      p_external_reference: input.externalReference ?? null,
      p_received_by: input.receivedBy ?? null,
      p_transaction_date: input.transactionDate ?? new Date().toISOString(),
      p_notes: input.notes ?? null,
    });

    if (error) throw new Error(error.message);
    return toCamel<Transaction>(data as Record<string, unknown>);
  },

  async ensureFolioForBooking(
    bookingId: string,
    guestId?: string | null,
  ): Promise<string> {
    const { data, error } = await supabase.rpc("ensure_folio_for_booking", {
      p_booking_id: bookingId,
      p_guest_id: guestId ?? null,
    });
    if (error) throw new Error(error.message);
    return String(data);
  },

  /** Map legacy UI payment mode strings to enum. */
  normalizePaymentMethod,

  /** FO checkout — folio + booking linked, optional UPI/card ref in externalReference. */
  async recordFrontOfficePayment(input: {
    amount: number;
    paymentMethod?: string;
    bookingId?: string | null;
    guestId?: string | null;
    folioId?: string | null;
    externalReference?: string | null;
    receivedBy?: string | null;
    notes?: string | null;
  }): Promise<Transaction> {
    let folioId = input.folioId ?? null;
    if (!folioId && input.bookingId) {
      folioId = await this.ensureFolioForBooking(
        input.bookingId,
        input.guestId ?? null,
      );
    }

    return this.recordViaRpc({
      amount: input.amount,
      paymentMethod: normalizePaymentMethod(input.paymentMethod) as RecordTransactionInput["paymentMethod"],
      folioId,
      bookingId: input.bookingId ?? null,
      guestId: input.guestId ?? null,
      sourceModule: "FRONT_OFFICE",
      externalReference: input.externalReference ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
    });
  },

  /** F&B order payment — no folio required. */
  async recordFnbPayment(input: {
    amount: number;
    orderId: string;
    paymentMethod?: string;
    externalReference?: string | null;
    receivedBy?: string | null;
    notes?: string | null;
  }): Promise<Transaction> {
    return this.recordViaRpc({
      amount: input.amount,
      paymentMethod: normalizePaymentMethod(input.paymentMethod) as RecordTransactionInput["paymentMethod"],
      sourceModule: "FNB",
      sourceId: input.orderId,
      externalReference: input.externalReference ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
    });
  },

  /** Reservation advance / deposit before check-in. */
  async recordReservationAdvance(input: {
    amount: number;
    bookingId: string;
    guestId?: string | null;
    paymentMethod?: string;
    externalReference?: string | null;
    receivedBy?: string | null;
    notes?: string | null;
  }): Promise<Transaction> {
    const folioId = await this.ensureFolioForBooking(
      input.bookingId,
      input.guestId ?? null,
    );

    return this.recordViaRpc({
      amount: input.amount,
      paymentMethod: normalizePaymentMethod(input.paymentMethod) as RecordTransactionInput["paymentMethod"],
      folioId,
      bookingId: input.bookingId,
      guestId: input.guestId ?? null,
      sourceModule: "RESERVATION",
      sourceId: input.bookingId,
      externalReference: input.externalReference ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
    });
  },
};

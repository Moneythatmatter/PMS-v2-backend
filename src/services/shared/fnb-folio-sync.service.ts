import { supabase } from "../../utils/supabase.js";
import { AppError } from "../../errors/index.js";

export const ROOM_SERVICE_SOURCE_TYPE = "ROOM_SERVICE";
export const ROOM_SERVICE_REVERSAL_SOURCE_TYPE = "ROOM_SERVICE_REVERSAL";

export function isRoomChargePayment(method?: string): boolean {
  return /room\s*charge/i.test(String(method ?? "").trim());
}

export function isRoomChargeSettledOrder(order: {
  type?: unknown;
  paymentMode?: unknown;
  payment_mode?: unknown;
} | null | undefined): boolean {
  if (!order) return false;
  if (String(order.type ?? "").trim() !== "Room Service") return false;
  const mode = String(order.paymentMode ?? order.payment_mode ?? "");
  return isRoomChargePayment(mode);
}

/** Atomic Room Charge settlement via Postgres RPC. */
export async function settleRoomChargeViaRpc(input: {
  billId: string;
  orderId: string;
  bookingId: string;
  guestId?: string | null;
  amount: number;
  notes?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("fnb_settle_room_charge", {
    p_bill_id: input.billId,
    p_order_id: input.orderId,
    p_booking_id: input.bookingId,
    p_guest_id: input.guestId ?? null,
    p_amount: Number(input.amount),
    p_notes: input.notes ?? null,
  });

  if (error) {
    throw new AppError(error.message, 400);
  }

  return (data ?? {}) as Record<string, unknown>;
}

/** Atomic bill + folio sync after cancellation on Room Charge bills. */
export async function syncRoomServiceAfterCancellationViaRpc(input: {
  billId: string;
  orderId: string;
  newSubtotal: number;
  newTax?: number;
  newDiscount?: number;
  newTotal: number;
  reversalNotes?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(
    "fnb_sync_room_service_after_cancellation",
    {
      p_bill_id: input.billId,
      p_order_id: input.orderId,
      p_new_subtotal: Number(input.newSubtotal),
      p_new_tax: Number(input.newTax ?? 0),
      p_new_discount: Number(input.newDiscount ?? 0),
      p_new_total: Number(input.newTotal),
      p_reversal_notes: input.reversalNotes ?? null,
    },
  );

  if (error) {
    throw new AppError(error.message, 400);
  }

  return (data ?? {}) as Record<string, unknown>;
}

export type TransactionType = "PAYMENT" | "REFUND" | "ADJUSTMENT";

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "UPI"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "OTHER";

export type TransactionStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "VOIDED"
  | "REFUNDED";

export type TransactionSourceModule =
  | "FRONT_OFFICE"
  | "FNB"
  | "RESERVATION"
  | "HOUSEKEEPING"
  | "MAINTENANCE"
  | "ACCOUNTS"
  | "OTHER";

export type FolioStatus = "OPEN" | "CLOSED" | "VOID";

export interface Folio {
  id: string;
  folioNumber?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  status: FolioStatus;
  currency: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  openedAt?: string;
  closedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transaction {
  id: string;
  transactionNumber: string;
  transactionType: TransactionType;
  paymentMethod: PaymentMethod;
  amount: number;
  currency: string;
  status: TransactionStatus;
  folioId?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  sourceModule?: TransactionSourceModule | null;
  sourceId?: string | null;
  externalReference?: string | null;
  receivedBy?: string | null;
  transactionDate: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type RecordTransactionInput = {
  amount: number;
  transactionType?: TransactionType;
  paymentMethod?: PaymentMethod;
  currency?: string;
  status?: TransactionStatus;
  folioId?: string | null;
  bookingId?: string | null;
  guestId?: string | null;
  sourceModule?: TransactionSourceModule | null;
  sourceId?: string | null;
  externalReference?: string | null;
  receivedBy?: string | null;
  transactionDate?: string;
  notes?: string | null;
};

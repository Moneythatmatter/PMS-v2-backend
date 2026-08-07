/**
 * Central ID generator — primary keys are UUID v4.
 * Human-readable numbers (txn / order display codes) stay prefixed.
 */
function token(): string {
  return Date.now().toString(36).toUpperCase();
}

function uuid(): string {
  return crypto.randomUUID();
}

export const IdService = {
  /** @param _prefix kept for call-site compatibility; value is always a UUID. */
  generate(_prefix?: string): string {
    return uuid();
  },

  generateReservation(): string {
    return uuid();
  },

  generateGuest(): string {
    return uuid();
  },

  generatePayment(): string {
    return uuid();
  },

  generateActivity(): string {
    return uuid();
  },

  generateStayHistory(): string {
    return uuid();
  },

  /** Display / receipt number — not a primary key. */
  generateTransactionNo(): string {
    return `TXN-${token()}`;
  },
};

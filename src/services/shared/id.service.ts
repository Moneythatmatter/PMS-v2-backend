/**
 * Central ID generator — one place for all entity ID formats.
 */
function token(): string {
  return Date.now().toString(36).toUpperCase();
}

export const IdService = {
  generate(prefix: string): string {
    return `${prefix}-${token()}`;
  },

  generateReservation(): string {
    return this.generate("BK");
  },

  generateGuest(): string {
    return this.generate("G");
  },

  generatePayment(): string {
    return this.generate("PAY");
  },

  generateActivity(): string {
    return this.generate("DA");
  },

  generateStayHistory(): string {
    return this.generate("SH");
  },

  generateTransactionNo(): string {
    return `TXN-${token()}`;
  },
};

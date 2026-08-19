export declare const IdService: {
    /** @param _prefix kept for call-site compatibility; value is always a UUID. */
    generate(_prefix?: string): string;
    generateReservation(): string;
    generateGuest(): string;
    generatePayment(): string;
    generateActivity(): string;
    generateStayHistory(): string;
    /** Display / receipt number — not a primary key. */
    generateTransactionNo(): string;
};

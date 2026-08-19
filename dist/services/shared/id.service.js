/**
 * Central ID generator — primary keys are UUID v4.
 * Human-readable numbers (txn / order display codes) stay prefixed.
 */
function token() {
    return Date.now().toString(36).toUpperCase();
}
function uuid() {
    return crypto.randomUUID();
}
export const IdService = {
    /** @param _prefix kept for call-site compatibility; value is always a UUID. */
    generate(_prefix) {
        return uuid();
    },
    generateReservation() {
        return uuid();
    },
    generateGuest() {
        return uuid();
    },
    generatePayment() {
        return uuid();
    },
    generateActivity() {
        return uuid();
    },
    generateStayHistory() {
        return uuid();
    },
    /** Display / receipt number — not a primary key. */
    generateTransactionNo() {
        return `TXN-${token()}`;
    },
};
//# sourceMappingURL=id.service.js.map
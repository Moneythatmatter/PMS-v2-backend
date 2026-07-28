/**
 * Central ID generator — one place for all entity ID formats.
 */
function token() {
    return Date.now().toString(36).toUpperCase();
}
export const IdService = {
    generate(prefix) {
        return `${prefix}-${token()}`;
    },
    generateReservation() {
        return this.generate("BK");
    },
    generateGuest() {
        return this.generate("G");
    },
    generatePayment() {
        return this.generate("PAY");
    },
    generateActivity() {
        return this.generate("DA");
    },
    generateStayHistory() {
        return this.generate("SH");
    },
    generateTransactionNo() {
        return `TXN-${token()}`;
    },
};
//# sourceMappingURL=id.service.js.map
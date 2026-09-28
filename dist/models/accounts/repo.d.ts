export declare const accTables: {
    readonly currencies: "acc_currencies";
    readonly companies: "acc_companies";
    readonly companySettings: "acc_company_settings";
    readonly fiscalYears: "acc_fiscal_years";
    readonly fiscalPeriods: "acc_fiscal_periods";
    readonly accounts: "acc_accounts";
    readonly divisions: "acc_divisions";
    readonly partyTypes: "acc_party_types";
    readonly partySubTypes: "acc_party_sub_types";
    readonly paymentMethods: "acc_payment_methods";
    readonly parties: "acc_parties";
    readonly voucherTypes: "acc_voucher_types";
    readonly revenueCategories: "acc_revenue_categories";
    readonly taxDefinitions: "acc_tax_definitions";
    readonly taxRules: "acc_tax_rules";
    readonly budgets: "acc_budgets";
    readonly vouchers: "acc_vouchers";
    readonly voucherLines: "acc_voucher_lines";
    readonly partyBills: "acc_party_bills";
    readonly billSettlements: "acc_bill_settlements";
    readonly closingStock: "acc_closing_stock_items";
    readonly coveringLetters: "acc_covering_letters";
    readonly coveringLetterBills: "acc_covering_letter_bills";
    readonly auditLogs: "acc_audit_logs";
};
export type AccTable = (typeof accTables)[keyof typeof accTables];
export type Row = Record<string, any>;
export declare function isUuid(value: unknown): value is string;
export declare function requireUuid(value: unknown, label?: string): string;
export declare function propertyId(): string;
export type ListOptions = {
    eq?: Record<string, string | number | boolean | null | undefined>;
    in?: Record<string, readonly (string | number)[] | undefined>;
    gte?: Record<string, string | number | undefined>;
    lte?: Record<string, string | number | undefined>;
    order?: {
        column: string;
        ascending?: boolean;
    }[];
    select?: string;
    limit?: number;
};
/** Property-scoped select. Pages through results so large ledgers are not truncated at 1000 rows. */
export declare function list<T = Row>(table: AccTable, opts?: ListOptions): Promise<T[]>;
export declare function getById<T = Row>(table: AccTable, id: string): Promise<T | null>;
export declare function mustGet<T = Row>(table: AccTable, id: string, label?: string): Promise<T>;
export declare function insert<T = Row>(table: AccTable, payload: Row): Promise<T>;
export declare function insertMany<T = Row>(table: AccTable, payloads: Row[]): Promise<T[]>;
export declare function update<T = Row>(table: AccTable, id: string, payload: Row): Promise<T>;
export declare function updateWhere(table: AccTable, payload: Row, where: {
    eq?: Record<string, string | number | boolean>;
    in?: Record<string, string[]>;
}): Promise<number>;
export declare function remove(table: AccTable, id: string): Promise<void>;
export declare function removeWhere(table: AccTable, eq: Record<string, string>): Promise<void>;
export declare function count(table: AccTable, eq: Record<string, string | number | boolean>, inFilter?: Record<string, string[]>): Promise<number>;
/**
 * Keep only writable columns: drops server-managed keys, unknown keys (when `allowed` is given),
 * and converts empty strings on *Id / *Date fields to null so uuid/date columns accept them.
 */
export declare function cleanPayload(body: Row, allowed?: readonly string[]): Row;
/** Display name of the signed-in user, used for created_by / posted_by / audit trails. */
export declare function actorName(): Promise<string>;
export declare function audit(entityType: string, entityId: string | null, action: string, opts?: {
    reason?: string | null;
    details?: Row;
}): Promise<void>;
export declare function round2(n: number): number;
export declare function num(v: unknown): number;
export declare function todayIso(): string;
export declare function isIsoDate(v: unknown): v is string;
export declare function daysBetween(fromIso: string, toIso: string): number;

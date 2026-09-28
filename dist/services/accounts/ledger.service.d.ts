export type Account = {
    id: string;
    parentId: string | null;
    code: string;
    name: string;
    accountType: "Group" | "Ledger";
    nature: "Asset" | "Liability" | "Income" | "Expense";
    reportSection: string;
    category: string;
    classification: string;
    isBankAccount: boolean;
    isCashAccount: boolean;
    isSystemAccount: boolean;
    allowPosting: boolean;
    status: string;
    bankAccountNo: string;
    bankIfsc: string;
};
export type LedgerLine = {
    id: string;
    voucherId: string;
    voucherNo: string;
    voucherDate: string;
    voucherCategory: string;
    voucherTypeId: string;
    voucherStatus: string;
    voucherNarration: string;
    referenceNo: string;
    instrumentNo: string;
    lineNo: number;
    accountId: string;
    partyId: string | null;
    divisionId: string | null;
    debit: number;
    credit: number;
    narration: string;
    chequeNo: string;
    chequeDate: string | null;
    reconciled: boolean;
    reconDate: string | null;
};
export declare function loadAccounts(): Promise<Account[]>;
/**
 * Posted voucher lines, optionally limited to a date window and/or accounts.
 * `from` / `to` are inclusive ISO dates. `statuses` defaults to Posted only.
 */
export declare function loadLines(opts?: {
    from?: string;
    to?: string;
    accountIds?: string[];
    partyId?: string;
    statuses?: string[];
}): Promise<LedgerLine[]>;
export type Balance = {
    debit: number;
    credit: number;
    net: number;
};
/** Sum debit / credit per account. `net` is debit − credit. */
export declare function sumByAccount(lines: LedgerLine[]): Map<string, Balance>;
export declare function isDebitNature(nature: string): boolean;
/** Balance shown in the account's natural direction (positive = normal). */
export declare function naturalBalance(nature: string, net: number): number;
export declare function drCr(net: number): {
    amount: number;
    side: "Dr" | "Cr";
};
export declare function previousDay(iso: string): string;
export declare function addDays(iso: string, days: number): string;
export type AccountTreeNode = Account & {
    level: number;
    children: AccountTreeNode[];
    debit: number;
    credit: number;
    net: number;
};
/** Build the COA tree with balances rolled up from ledgers into their groups. */
export declare function buildTree(accounts: Account[], balances: Map<string, Balance>): AccountTreeNode[];
/** Map every account id to its top-level ancestor's report section (falls back to own section). */
export declare function sectionOf(accounts: Account[]): Map<string, string>;

import { type Row } from "../../models/accounts/repo.js";
import { isDebitNature } from "./ledger.service.js";
export declare function trialBalance(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    rows: {
        accountId: string;
        parentId: string | null;
        code: string;
        name: string;
        accountType: "Group" | "Ledger";
        nature: "Asset" | "Liability" | "Income" | "Expense";
        level: number;
        openingDebit: number;
        openingCredit: number;
        debit: number;
        credit: number;
        closingDebit: number;
        closingCredit: number;
    }[];
    totals: {
        openingDebit: number;
        openingCredit: number;
        debit: number;
        credit: number;
        closingDebit: number;
        closingCredit: number;
    };
    balanced: boolean;
    difference: number;
}>;
export declare function profitLoss(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    compareFrom: string;
    compareTo: string;
    sections: {
        section: "Direct Income" | "Indirect Income" | "Direct Expenses" | "Indirect Expenses";
        accounts: {
            accountId: string;
            code: string;
            name: string;
            category: string;
            amount: number;
            previousAmount: number;
        }[];
        total: number;
        previousTotal: number;
    }[];
    summary: {
        totalRevenue: number;
        directIncome: number;
        indirectIncome: number;
        directExpenses: number;
        indirectExpenses: number;
        totalExpenses: number;
        grossProfit: number;
        grossMargin: number;
        operatingProfit: number;
        financeCosts: number;
        netProfit: number;
        netMargin: number;
        previousNetProfit: number;
        netProfitChange: number;
        roomRevenue: number;
        foodRevenue: number;
        beverageRevenue: number;
        banquetRevenue: number;
        otherOperatingRevenue: number;
        otherIncome: number;
        costOfSales: number;
        payroll: number;
        utilities: number;
        repairsMaintenance: number;
        salesMarketing: number;
        administrative: number;
        commission: number;
    };
    categories: {
        category: string;
        nature: string;
        amount: number;
    }[];
    monthly: {
        month: string;
        income: number;
        expense: number;
        net: number;
    }[];
    divisions: {
        net: number;
        divisionId: string | null;
        divisionName: string;
        income: number;
        expense: number;
    }[];
}>;
export declare function balanceSheet(query: Record<string, unknown>): Promise<{
    asOn: string;
    compareAsOn: string;
    assets: {
        section: string;
        groups: {
            total: number;
            previousTotal: number;
            groupId: string | null;
            groupName: string;
            accounts: Row[];
        }[];
        total: number;
        previousTotal: number;
    }[];
    liabilities: {
        section: string;
        groups: {
            total: number;
            previousTotal: number;
            groupId: string | null;
            groupName: string;
            accounts: Row[];
        }[];
        total: number;
        previousTotal: number;
    }[];
    totals: {
        totalAssets: number;
        totalLiabilities: number;
        previousTotalAssets: number;
        previousTotalLiabilities: number;
        difference: number;
        balanced: boolean;
    };
    ratios: {
        currentRatio: number | null;
        quickRatio: number | null;
        debtEquity: number | null;
        workingCapital: number;
    };
}>;
export declare function generalLedger(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    account: {
        id: string;
        code: string;
        name: string;
        nature: "Asset" | "Liability" | "Income" | "Expense";
        accountType: "Group" | "Ledger";
    } | null;
    party: {
        id: any;
        code: any;
        name: any;
    } | null;
    opening: {
        net: number;
        amount: number;
        side: "Dr" | "Cr";
    };
    entries: {
        lineId: string;
        voucherId: string;
        voucherNo: string;
        voucherDate: string;
        voucherType: any;
        voucherTypeCode: any;
        accountName: string | null;
        particulars: string;
        narration: string;
        referenceNo: string;
        chequeNo: string;
        partyName: string | null;
        divisionName: string | null;
        debit: number;
        credit: number;
        balance: number;
        balanceSide: string;
    }[];
    totals: {
        debit: number;
        credit: number;
    };
    closing: {
        net: number;
        amount: number;
        side: "Dr" | "Cr";
    };
}>;
export declare function dayBook(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    vouchers: Row[];
    summary: {
        voucherCount: number;
        totalDebit: number;
        totalCredit: number;
        openingCashBank: number;
        inflow: number;
        outflow: number;
        closingCashBank: number;
        openingCash: number;
        closingCash: number;
        byCategory: {
            category: string;
            count: number;
            amount: number;
        }[];
    };
}>;
export declare function outstandingBills(query: Record<string, unknown>): Promise<{
    totals: {
        bucket: string;
        amount: number;
        count: number;
    }[];
    totalOutstanding: number;
    totalBillAmount: number;
    asOnDate: string;
    slabs: number[];
    labels: string[];
    ageBy: string;
    moduleType: string;
    bills: (Row & {
        amount: number;
        settledAmount: number;
        balance: number;
        overdueDays: number;
        billAgeDays: number;
        partyName: string | null;
        partyCode: string | null;
        partyGroup: string | null;
        settlementStatus: "Unpaid" | "Partial" | "Settled";
    } & {
        ageDays: number;
        bucketIndex: number;
        bucket: string;
    })[];
}>;
export declare function agingSummary(query: Record<string, unknown>): Promise<{
    asOnDate: string;
    slabs: number[];
    labels: string[];
    ageBy: string;
    moduleType: string;
    rows: {
        partyId: any;
        partyCode: any;
        partyName: any;
        partyGroup: any;
        city: any;
        creditDays: number;
        creditLimit: number;
        overLimit: boolean;
        billsCount: number;
        oldestDays: number;
        buckets: number[];
        total: number;
    }[];
    totals: {
        buckets: number[];
        total: number;
    };
}>;
export declare function partySettlement(query: Record<string, unknown>): Promise<{
    from: string | null;
    to: string;
    bills: {
        settlements: {
            voucherNo: string | null;
        }[];
        amount: number;
        settledAmount: number;
        balance: number;
        overdueDays: number;
        billAgeDays: number;
        partyName: string | null;
        partyCode: string | null;
        partyGroup: string | null;
        settlementStatus: "Unpaid" | "Partial" | "Settled";
    }[];
    totals: {
        billAmount: number;
        settled: number;
        balance: number;
    };
}>;
export declare function reminderLetters(query: Record<string, unknown>): Promise<{
    asOnDate: string;
    parties: {
        partyId: any;
        partyCode: any;
        partyName: any;
        partyGroup: any;
        contactPersonName: any;
        email: any;
        phone: any;
        address: string;
        maxOverdueDays: number;
        totalOverdue: number;
        bills: {
            billId: any;
            billNo: any;
            billDate: any;
            dueDate: any;
            amount: number;
            balance: number;
            overdueDays: number;
            details: any;
        }[];
    }[];
}>;
export declare function balanceConfirmation(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    rows: {
        partyId: any;
        partyCode: any;
        partyName: any;
        partyGroup: any;
        contactPersonName: any;
        email: any;
        address: string;
        gstin: any;
        opening: {
            net: number;
            amount: number;
            side: "Dr" | "Cr";
        };
        debit: number;
        credit: number;
        closing: {
            net: number;
            amount: number;
            side: "Dr" | "Cr";
        };
    }[];
}>;
export declare function paymentAdvice(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    advices: {
        voucherId: any;
        voucherNo: any;
        voucherDate: any;
        amount: number;
        narration: any;
        referenceNo: any;
        instrumentNo: any;
        instrumentDate: any;
        paymentMethodName: any;
        bankCashAccountName: any;
        partyId: any;
        partyName: any;
        partyCode: any;
        partyEmail: any;
        partyAddress: string;
        bankName: any;
        bankAccountNumber: any;
        bankIfsc: any;
        bills: {
            billId: any;
            billNo: any;
            billDate: any;
            billAmount: number | null;
            paidAmount: number;
            deductions: number;
        }[];
    }[];
}>;
export declare function financialAnalysis(query: Record<string, unknown>): Promise<{
    from: string;
    to: string;
    fiscalYearId: any;
    fiscalYearName: any;
    summary: {
        totalRevenue: number;
        directIncome: number;
        indirectIncome: number;
        directExpenses: number;
        indirectExpenses: number;
        totalExpenses: number;
        grossProfit: number;
        grossMargin: number;
        operatingProfit: number;
        financeCosts: number;
        netProfit: number;
        netMargin: number;
        previousNetProfit: number;
        netProfitChange: number;
        roomRevenue: number;
        foodRevenue: number;
        beverageRevenue: number;
        banquetRevenue: number;
        otherOperatingRevenue: number;
        otherIncome: number;
        costOfSales: number;
        payroll: number;
        utilities: number;
        repairsMaintenance: number;
        salesMarketing: number;
        administrative: number;
        commission: number;
    };
    departments: {
        share: number;
        budget: number | null;
        net: number;
        divisionId: string | null;
        divisionName: string;
        income: number;
        expense: number;
    }[];
    quarterly: {
        quarter: string;
        from: string;
        to: string;
        income: number;
        expense: number;
        net: number;
    }[];
    monthly: {
        month: string;
        income: number;
        expense: number;
        net: number;
    }[];
    ratios: {
        grossMargin: number;
        netMargin: number;
        payrollPercent: number;
        costOfSalesPercent: number;
        currentRatio: number | null;
        quickRatio: number | null;
        debtEquity: number | null;
        workingCapital: number;
        receivableDays: number;
        payableDays: number;
    };
    receivablesAging: {
        labels: string[];
        totals: {
            buckets: number[];
            total: number;
        };
        topParties: {
            partyId: any;
            partyCode: any;
            partyName: any;
            partyGroup: any;
            city: any;
            creditDays: number;
            creditLimit: number;
            overLimit: boolean;
            billsCount: number;
            oldestDays: number;
            buckets: number[];
            total: number;
        }[];
    };
    payablesOutstanding: number;
    budgets: {
        budgetId: any;
        divisionId: any;
        divisionName: any;
        divisionCode: any;
        budget: number;
        actual: number;
        variance: number;
        utilization: number;
    }[];
}>;
export declare function dashboard(query: Record<string, unknown>): Promise<{
    asOn: string;
    fiscalYearName: any;
    kpis: {
        cashBalance: number;
        bankBalance: number;
        receivables: number;
        overdueReceivables: number;
        payables: number;
        revenueMtd: number;
        expensesMtd: number;
        netProfitMtd: number;
        revenueYtd: number;
        expensesYtd: number;
        netProfitYtd: number;
        netMarginYtd: number;
        gstPayable: number;
        draftVouchers: number;
        provisionalEntries: number;
        unreconciledBankEntries: number;
    };
    departmentRevenue: {
        name: string;
        value: number;
    }[];
    channelRevenue: {
        name: string;
        value: number;
    }[];
    monthly: {
        month: string;
        income: number;
        expense: number;
        net: number;
    }[];
    revenueMix: {
        name: string;
        value: number;
    }[];
    upcomingVendorPayments: {
        billId: any;
        partyId: any;
        partyName: string | null;
        billNo: any;
        billDate: any;
        dueDate: any;
        amount: number;
        balance: number;
        overdueDays: number;
        status: string;
    }[];
    recentVouchers: {
        id: any;
        voucherNo: any;
        voucherDate: any;
        voucherTypeName: any;
        voucherCategory: any;
        narration: any;
        partyName: any;
        totalAmount: any;
        status: any;
    }[];
}>;
export { isDebitNature };

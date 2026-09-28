import {
  accTables,
  actorName,
  cleanPayload,
  count,
  getById,
  insert,
  isIsoDate,
  list,
  mustGet,
  num,
  remove,
  requireUuid,
  round2,
  update,
  type AccTable,
  type Row,
} from "../../models/accounts/repo.js";
import { ConflictError, ValidationError } from "../../errors/index.js";
import { generatePeriodsForYear } from "./fiscal.service.js";

type MasterConfig = {
  key: string;
  table: AccTable;
  label: string;
  columns: readonly string[];
  required: readonly string[];
  order: { column: string; ascending?: boolean }[];
  filterable?: readonly string[];
  uppercase?: readonly string[];
  autoCode?: { field: string; prefix: string; pad: number };
  defaults?: Row;
  validate?: (payload: Row, existing: Row | null) => Promise<void> | void;
  afterCreate?: (row: Row) => Promise<void>;
  afterSave?: (row: Row) => Promise<void>;
  beforeDelete?: (row: Row) => Promise<void>;
  enrich?: (rows: Row[]) => Promise<Row[]>;
};

const STATUS_VALUES = ["Active", "Inactive"];

function assertStatus(payload: Row, allowed = STATUS_VALUES) {
  if (payload.status !== undefined && !allowed.includes(payload.status)) {
    throw new ValidationError(`Status must be one of: ${allowed.join(", ")}`);
  }
}

function assertNonNegative(payload: Row, fields: string[]) {
  for (const f of fields) {
    if (payload[f] !== undefined && payload[f] !== null && num(payload[f]) < 0) {
      throw new ValidationError(`${f} cannot be negative`);
    }
  }
}

async function nameMap(table: AccTable, labelField: string, extra?: string): Promise<Map<string, Row>> {
  const rows = await list(table, { select: `id,${labelField}${extra ? "," + extra : ""}` });
  return new Map(rows.map((r) => [r.id as string, r]));
}

async function usageCounts(table: AccTable, column: string): Promise<Map<string, number>> {
  const snake = column.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  const rows = await list(table, { select: snake });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = r[column] as string | null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function blockIfUsed(table: AccTable, column: string, id: string, message: string) {
  if ((await count(table, { [column]: id })) > 0) throw new ConflictError(message);
}

async function nextCode(table: AccTable, field: string, prefix: string, pad: number): Promise<string> {
  const snake = field.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  const rows = await list(table, { select: snake });
  let max = 0;
  for (const r of rows) {
    const m = String(r[field] ?? "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(pad, "0")}`;
}

// ---------------------------------------------------------------------------
// Master definitions
// ---------------------------------------------------------------------------

const currencies: MasterConfig = {
  key: "currencies",
  table: accTables.currencies,
  label: "Currency",
  columns: [
    "code", "name", "symbol", "country", "decimalPlaces", "isBaseCurrency", "exchangeRateToBase",
    "rateEffectiveDate", "rateSource", "foreignTransactionsAllowed", "status",
  ],
  required: ["code", "name"],
  uppercase: ["code"],
  order: [{ column: "is_base_currency", ascending: false }, { column: "code" }],
  filterable: ["status"],
  validate: (p) => {
    assertStatus(p);
    if (p.code !== undefined && !/^[A-Z]{3}$/.test(p.code)) {
      throw new ValidationError("Currency code must be a 3-letter ISO code (e.g. USD)");
    }
    if (p.exchangeRateToBase !== undefined && num(p.exchangeRateToBase) <= 0) {
      throw new ValidationError("Exchange rate must be greater than zero");
    }
    if (p.decimalPlaces !== undefined && (num(p.decimalPlaces) < 0 || num(p.decimalPlaces) > 4)) {
      throw new ValidationError("Decimal places must be between 0 and 4");
    }
    if (p.isBaseCurrency === true) {
      p.exchangeRateToBase = 1;
      p.status = "Active";
    }
  },
  afterSave: async (row) => {
    if (!row.isBaseCurrency) return;
    const others = await list(accTables.currencies, { eq: { is_base_currency: true } });
    for (const o of others) {
      if (o.id !== row.id) await update(accTables.currencies, o.id, { isBaseCurrency: false });
    }
  },
  beforeDelete: async (row) => {
    if (row.isBaseCurrency) throw new ConflictError("The base currency cannot be deleted");
    await blockIfUsed(accTables.parties, "currency_id", row.id, "Currency is assigned to parties");
  },
};

const companies: MasterConfig = {
  key: "companies",
  table: accTables.companies,
  label: "Company",
  columns: [
    "companyCode", "tradeName", "legalName", "alias", "companyType", "businessNature", "status", "logoUrl",
    "addressLine1", "addressLine2", "city", "district", "state", "pincode", "country", "primaryContact",
    "mobile", "telephone", "email", "website", "gstNumber", "panNumber", "tanNumber", "cinNumber",
    "msmeNumber", "registrationDate", "taxRegion", "gstApplicable", "baseCurrencyId",
  ],
  required: ["companyCode", "tradeName"],
  uppercase: ["companyCode", "gstNumber", "panNumber", "tanNumber", "cinNumber"],
  order: [{ column: "trade_name" }],
  filterable: ["status"],
  validate: (p) => {
    assertStatus(p);
    if (p.gstNumber && !/^[0-9]{2}[A-Z0-9]{13}$/.test(p.gstNumber)) {
      throw new ValidationError("GSTIN must be 15 characters (e.g. 21AAHCS7865M1Z2)");
    }
    if (p.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p.panNumber)) {
      throw new ValidationError("PAN must be in the format AAAAA9999A");
    }
    if (p.email && !/^\S+@\S+\.\S+$/.test(p.email)) throw new ValidationError("Invalid email address");
  },
  afterCreate: async (row) => {
    await insert(accTables.companySettings, { companyId: row.id, configuredBy: await actorName() });
  },
  beforeDelete: async () => {
    if ((await count(accTables.companies, {})) <= 1) {
      throw new ConflictError("At least one company must exist");
    }
  },
  enrich: async (rows) => {
    const cur = await nameMap(accTables.currencies, "code", "name,symbol");
    return rows.map((r) => ({
      ...r,
      baseCurrencyCode: r.baseCurrencyId ? cur.get(r.baseCurrencyId)?.code ?? null : null,
    }));
  },
};

const accounts: MasterConfig = {
  key: "accounts",
  table: accTables.accounts,
  label: "Account",
  columns: [
    "parentId", "code", "name", "accountType", "nature", "reportSection", "category", "classification",
    "description", "allowPosting", "isBankAccount", "isCashAccount", "bankAccountNo", "bankIfsc", "status",
  ],
  required: ["code", "name", "accountType", "nature"],
  order: [{ column: "code" }],
  filterable: ["status", "accountType", "nature", "parentId", "isBankAccount", "isCashAccount"],
  validate: async (p, existing) => {
    assertStatus(p);
    if (p.accountType && !["Group", "Ledger"].includes(p.accountType)) {
      throw new ValidationError("Account type must be Group or Ledger");
    }
    if (p.nature && !["Asset", "Liability", "Income", "Expense"].includes(p.nature)) {
      throw new ValidationError("Nature must be Asset, Liability, Income or Expense");
    }
    const parentId = p.parentId !== undefined ? p.parentId : existing?.parentId;
    if (parentId) {
      if (existing && parentId === existing.id) throw new ValidationError("An account cannot be its own parent");
      const parent = await getById(accTables.accounts, parentId);
      if (!parent) throw new ValidationError("Parent account not found");
      if (parent.accountType !== "Group") throw new ValidationError("Parent must be a Group account");
      p.nature = parent.nature;
      if (!p.reportSection && !existing?.reportSection) p.reportSection = parent.reportSection;
    }
    const type = p.accountType ?? existing?.accountType;
    if (type === "Group") {
      p.allowPosting = false;
      p.isBankAccount = false;
      p.isCashAccount = false;
    }
    if (existing && p.accountType && p.accountType !== existing.accountType) {
      if (p.accountType === "Group" && (await count(accTables.voucherLines, { account_id: existing.id })) > 0) {
        throw new ConflictError("Ledger has transactions and cannot be converted to a Group");
      }
      if (p.accountType === "Ledger" && (await count(accTables.accounts, { parent_id: existing.id })) > 0) {
        throw new ConflictError("Group has child accounts and cannot be converted to a Ledger");
      }
    }
    if (existing?.isSystemAccount && p.code && p.code !== existing.code) {
      throw new ConflictError("System account codes cannot be changed");
    }
  },
  beforeDelete: async (row) => {
    if (row.isSystemAccount) throw new ConflictError("System accounts cannot be deleted");
    await blockIfUsed(accTables.accounts, "parent_id", row.id, "Account has child accounts");
    await blockIfUsed(accTables.voucherLines, "account_id", row.id, "Account has posted transactions");
  },
  enrich: async (rows) => {
    const [txn, all] = await Promise.all([
      usageCounts(accTables.voucherLines, "accountId"),
      list(accTables.accounts, { select: "id,parent_id,name,code" }),
    ]);
    const byId = new Map(all.map((a) => [a.id as string, a]));
    const childCount = new Map<string, number>();
    for (const a of all) if (a.parentId) childCount.set(a.parentId, (childCount.get(a.parentId) ?? 0) + 1);
    const levelOf = (id: string): number => {
      let level = 1;
      let cur = byId.get(id);
      while (cur?.parentId && level < 20) {
        level++;
        cur = byId.get(cur.parentId);
      }
      return level;
    };
    return rows.map((r) => ({
      ...r,
      parentName: r.parentId ? byId.get(r.parentId)?.name ?? null : null,
      parentCode: r.parentId ? byId.get(r.parentId)?.code ?? null : null,
      level: levelOf(r.id),
      childCount: childCount.get(r.id) ?? 0,
      transactionCount: txn.get(r.id) ?? 0,
    }));
  },
};

const divisions: MasterConfig = {
  key: "divisions",
  table: accTables.divisions,
  label: "Division",
  columns: [
    "companyId", "parentDivisionId", "divisionCode", "divisionName", "shortName", "divisionType",
    "sequence", "description", "status",
  ],
  required: ["divisionCode", "divisionName"],
  uppercase: ["divisionCode"],
  order: [{ column: "sequence" }, { column: "division_name" }],
  filterable: ["status", "parentDivisionId", "divisionType"],
  validate: (p, existing) => {
    assertStatus(p);
    if (existing && p.parentDivisionId && p.parentDivisionId === existing.id) {
      throw new ValidationError("A division cannot be its own parent");
    }
  },
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.divisions, "parent_division_id", row.id, "Division has sub-divisions");
    await blockIfUsed(accTables.voucherLines, "division_id", row.id, "Division is used in transactions");
  },
  enrich: async (rows) => {
    const [txn, names] = await Promise.all([
      usageCounts(accTables.voucherLines, "divisionId"),
      nameMap(accTables.divisions, "division_name"),
    ]);
    return rows.map((r) => ({
      ...r,
      parentDivisionName: r.parentDivisionId ? names.get(r.parentDivisionId)?.divisionName ?? null : null,
      transactionCount: txn.get(r.id) ?? 0,
    }));
  },
};

const partyTypes: MasterConfig = {
  key: "partyTypes",
  table: accTables.partyTypes,
  label: "Party type",
  columns: ["typeCode", "typeName", "description", "sequence", "status"],
  required: ["typeCode", "typeName"],
  uppercase: ["typeCode"],
  order: [{ column: "sequence" }, { column: "type_name" }],
  filterable: ["status"],
  validate: (p) => assertStatus(p),
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.partySubTypes, "party_type_id", row.id, "Party type has sub types");
    await blockIfUsed(accTables.parties, "party_type_id", row.id, "Party type is assigned to parties");
  },
  enrich: async (rows) => {
    const [subs, parties] = await Promise.all([
      usageCounts(accTables.partySubTypes, "partyTypeId"),
      usageCounts(accTables.parties, "partyTypeId"),
    ]);
    return rows.map((r) => ({ ...r, subTypeCount: subs.get(r.id) ?? 0, partyCount: parties.get(r.id) ?? 0 }));
  },
};

const partySubTypes: MasterConfig = {
  key: "partySubTypes",
  table: accTables.partySubTypes,
  label: "Party sub type",
  columns: ["partyTypeId", "subTypeCode", "subTypeName", "description", "sequence", "status"],
  required: ["partyTypeId", "subTypeCode", "subTypeName"],
  uppercase: ["subTypeCode"],
  order: [{ column: "sequence" }, { column: "sub_type_name" }],
  filterable: ["status", "partyTypeId"],
  validate: (p) => assertStatus(p),
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.parties, "party_sub_type_id", row.id, "Sub type is assigned to parties");
  },
  enrich: async (rows) => {
    const [types, parties] = await Promise.all([
      nameMap(accTables.partyTypes, "type_name", "type_code"),
      usageCounts(accTables.parties, "partySubTypeId"),
    ]);
    return rows.map((r) => ({
      ...r,
      partyTypeName: types.get(r.partyTypeId)?.typeName ?? null,
      partyTypeCode: types.get(r.partyTypeId)?.typeCode ?? null,
      partyCount: parties.get(r.id) ?? 0,
    }));
  },
};

const paymentMethods: MasterConfig = {
  key: "paymentMethods",
  table: accTables.paymentMethods,
  label: "Payment method",
  columns: [
    "companyId", "accountId", "paymentMethodCode", "paymentMethodName", "methodType", "referenceRequired",
    "description", "status",
  ],
  required: ["paymentMethodCode", "paymentMethodName", "methodType"],
  uppercase: ["paymentMethodCode"],
  order: [{ column: "payment_method_name" }],
  filterable: ["status", "methodType"],
  validate: (p) => assertStatus(p),
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.vouchers, "payment_method_id", row.id, "Payment method is used in vouchers");
  },
  enrich: async (rows) => {
    const [txn, accs] = await Promise.all([
      usageCounts(accTables.vouchers, "paymentMethodId"),
      nameMap(accTables.accounts, "name", "code"),
    ]);
    return rows.map((r) => ({
      ...r,
      accountName: r.accountId ? accs.get(r.accountId)?.name ?? null : null,
      transactionCount: txn.get(r.id) ?? 0,
    }));
  },
};

const PARTY_COLUMNS = [
  "partyCode", "partyName", "shortName", "partyTypeId", "partySubTypeId", "partyGroup", "entityType", "email",
  "phone", "alternatePhone", "website", "addressLine1", "addressLine2", "city", "state", "postalCode", "country",
  "contactPersonName", "contactPersonPhone", "contactPersonEmail", "contactPersonDesignation", "panNumber",
  "gstin", "gstRegistrationType", "tanNumber", "msmeNumber", "msmeType", "currencyId", "creditDays",
  "creditLimit", "paymentMethodId", "bankName", "bankAccountNumber", "bankIfsc", "bankBranch",
  "bankAccountType", "receivableAccountId", "payableAccountId", "remarks", "status",
] as const;

const parties: MasterConfig = {
  key: "parties",
  table: accTables.parties,
  label: "Party",
  columns: PARTY_COLUMNS,
  required: ["partyName"],
  uppercase: ["partyCode", "panNumber", "gstin", "tanNumber", "bankIfsc"],
  autoCode: { field: "partyCode", prefix: "P-", pad: 4 },
  order: [{ column: "party_name" }],
  filterable: ["status", "partyTypeId", "partySubTypeId", "partyGroup"],
  validate: async (p) => {
    assertStatus(p, ["Active", "Inactive", "Blocked"]);
    assertNonNegative(p, ["creditDays", "creditLimit"]);
    if (p.email && !/^\S+@\S+\.\S+$/.test(p.email)) throw new ValidationError("Invalid email address");
    if (p.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(p.gstin)) throw new ValidationError("GSTIN must be 15 characters");
    if (p.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p.panNumber)) {
      throw new ValidationError("PAN must be in the format AAAAA9999A");
    }
    if (p.partySubTypeId && p.partyTypeId) {
      const sub = await getById(accTables.partySubTypes, p.partySubTypeId);
      if (sub && sub.partyTypeId !== p.partyTypeId) {
        throw new ValidationError("Sub type does not belong to the selected party type");
      }
    }
  },
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.voucherLines, "party_id", row.id, "Party has ledger transactions");
    await blockIfUsed(accTables.partyBills, "party_id", row.id, "Party has bills");
  },
  enrich: async (rows) => {
    const [types, subs, accs, cur, pms, outstanding] = await Promise.all([
      nameMap(accTables.partyTypes, "type_name", "type_code"),
      nameMap(accTables.partySubTypes, "sub_type_name", "sub_type_code"),
      nameMap(accTables.accounts, "name", "code"),
      nameMap(accTables.currencies, "code"),
      nameMap(accTables.paymentMethods, "payment_method_name"),
      partyOutstandingMap(),
    ]);
    return rows.map((r) => {
      const o = outstanding.get(r.id) ?? { receivable: 0, payable: 0, openBills: 0 };
      return {
        ...r,
        partyTypeName: r.partyTypeId ? types.get(r.partyTypeId)?.typeName ?? null : null,
        partyTypeCode: r.partyTypeId ? types.get(r.partyTypeId)?.typeCode ?? null : null,
        partySubTypeName: r.partySubTypeId ? subs.get(r.partySubTypeId)?.subTypeName ?? null : null,
        receivableAccountName: r.receivableAccountId ? accs.get(r.receivableAccountId)?.name ?? null : null,
        payableAccountName: r.payableAccountId ? accs.get(r.payableAccountId)?.name ?? null : null,
        currencyCode: r.currencyId ? cur.get(r.currencyId)?.code ?? null : null,
        paymentMethodName: r.paymentMethodId ? pms.get(r.paymentMethodId)?.paymentMethodName ?? null : null,
        outstandingReceivable: o.receivable,
        outstandingPayable: o.payable,
        outstandingBalance: round2(o.receivable - o.payable),
        openBillsCount: o.openBills,
      };
    });
  },
};

/** Open bill balances per party (bill amount minus settlements). */
export async function partyOutstandingMap(): Promise<
  Map<string, { receivable: number; payable: number; openBills: number }>
> {
  const [bills, settlements] = await Promise.all([
    list(accTables.partyBills, { eq: { status: "Open" }, select: "id,party_id,module_type,amount" }),
    list(accTables.billSettlements, { select: "bill_id,amount,deductions" }),
  ]);
  const settled = new Map<string, number>();
  for (const s of settlements) settled.set(s.billId, (settled.get(s.billId) ?? 0) + num(s.amount) + num(s.deductions));
  const out = new Map<string, { receivable: number; payable: number; openBills: number }>();
  for (const b of bills) {
    const bal = round2(num(b.amount) - (settled.get(b.id) ?? 0));
    if (bal <= 0) continue;
    const cur = out.get(b.partyId) ?? { receivable: 0, payable: 0, openBills: 0 };
    if (b.moduleType === "AR") cur.receivable = round2(cur.receivable + bal);
    else cur.payable = round2(cur.payable + bal);
    cur.openBills++;
    out.set(b.partyId, cur);
  }
  return out;
}

const voucherTypes: MasterConfig = {
  key: "voucherTypes",
  table: accTables.voucherTypes,
  label: "Voucher type",
  columns: [
    "companyId", "voucherTypeName", "shortCode", "category", "sequence", "numberingMethod", "prefixTemplate",
    "startingNumber", "numberPadding", "resetFrequency", "defaultEntryNature", "partyRequired",
    "divisionRequired", "status",
  ],
  required: ["voucherTypeName", "shortCode", "category"],
  uppercase: ["shortCode"],
  order: [{ column: "sequence" }, { column: "voucher_type_name" }],
  filterable: ["status", "category"],
  validate: async (p, existing) => {
    assertStatus(p);
    if (p.startingNumber !== undefined && num(p.startingNumber) < 1) {
      throw new ValidationError("Starting number must be at least 1");
    }
    if (p.numberPadding !== undefined && (num(p.numberPadding) < 1 || num(p.numberPadding) > 10)) {
      throw new ValidationError("Number padding must be between 1 and 10");
    }
    if (existing && (p.category || p.shortCode)) {
      const used = await count(accTables.vouchers, { voucher_type_id: existing.id });
      if (used > 0 && p.category && p.category !== existing.category) {
        throw new ConflictError("Category cannot change once vouchers exist for this type");
      }
    }
    if (existing?.isSystem && p.shortCode && p.shortCode !== existing.shortCode) {
      throw new ConflictError("System voucher type codes cannot be changed");
    }
  },
  beforeDelete: async (row) => {
    if (row.isSystem) throw new ConflictError("System voucher types cannot be deleted");
    await blockIfUsed(accTables.vouchers, "voucher_type_id", row.id, "Voucher type has vouchers");
  },
  enrich: async (rows) => {
    const vouchers = await list(accTables.vouchers, {
      select: "voucher_type_id,voucher_no,created_at",
      order: [{ column: "created_at", ascending: false }],
    });
    const stats = new Map<string, { count: number; last: string | null }>();
    for (const v of vouchers) {
      const s = stats.get(v.voucherTypeId) ?? { count: 0, last: null };
      if (!s.last) s.last = v.voucherNo;
      s.count++;
      stats.set(v.voucherTypeId, s);
    }
    return rows.map((r) => ({
      ...r,
      transactionCount: stats.get(r.id)?.count ?? 0,
      lastVoucherNo: stats.get(r.id)?.last ?? null,
    }));
  },
};

const revenueCategories: MasterConfig = {
  key: "revenueCategories",
  table: accTables.revenueCategories,
  label: "Revenue category",
  columns: ["companyId", "incomeAccountId", "revenueCategoryCode", "revenueCategoryName", "description", "status"],
  required: ["revenueCategoryCode", "revenueCategoryName"],
  uppercase: ["revenueCategoryCode"],
  order: [{ column: "revenue_category_name" }],
  filterable: ["status"],
  validate: (p) => assertStatus(p),
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.taxRules, "revenue_category_id", row.id, "Revenue category is used by tax rules");
  },
  enrich: async (rows) => {
    const [accs, rules] = await Promise.all([
      nameMap(accTables.accounts, "name", "code"),
      usageCounts(accTables.taxRules, "revenueCategoryId"),
    ]);
    return rows.map((r) => ({
      ...r,
      incomeAccountName: r.incomeAccountId ? accs.get(r.incomeAccountId)?.name ?? null : null,
      ruleCount: rules.get(r.id) ?? 0,
    }));
  },
};

const taxDefinitions: MasterConfig = {
  key: "taxDefinitions",
  table: accTables.taxDefinitions,
  label: "Tax",
  columns: [
    "companyId", "outputAccountId", "taxCode", "taxName", "taxType", "rate", "calculationType", "hsnSacCode",
    "description", "status",
  ],
  required: ["taxCode", "taxName", "rate"],
  uppercase: ["taxCode"],
  order: [{ column: "rate" }, { column: "tax_code" }],
  filterable: ["status", "taxType"],
  validate: (p) => {
    assertStatus(p);
    if (p.rate !== undefined && (num(p.rate) < 0 || (p.calculationType !== "Fixed" && num(p.rate) > 100))) {
      throw new ValidationError("Rate must be between 0 and 100");
    }
  },
  beforeDelete: async (row) => {
    await blockIfUsed(accTables.taxRules, "tax_id", row.id, "Tax is used by tax rules");
  },
  enrich: async (rows) => {
    const [accs, rules] = await Promise.all([
      nameMap(accTables.accounts, "name", "code"),
      usageCounts(accTables.taxRules, "taxId"),
    ]);
    return rows.map((r) => ({
      ...r,
      outputAccountName: r.outputAccountId ? accs.get(r.outputAccountId)?.name ?? null : null,
      ruleCount: rules.get(r.id) ?? 0,
    }));
  },
};

const taxRules: MasterConfig = {
  key: "taxRules",
  table: accTables.taxRules,
  label: "Tax rule",
  columns: [
    "companyId", "taxId", "revenueCategoryId", "divisionId", "taxRuleCode", "taxRuleName", "applicabilityType",
    "serviceType", "minimumAmount", "maximumAmount", "priority", "effectiveFrom", "effectiveTo", "description",
    "status",
  ],
  required: ["taxId", "taxRuleCode", "taxRuleName"],
  uppercase: ["taxRuleCode"],
  order: [{ column: "priority" }, { column: "tax_rule_code" }],
  filterable: ["status", "taxId", "revenueCategoryId"],
  validate: (p) => {
    assertStatus(p);
    assertNonNegative(p, ["minimumAmount", "maximumAmount"]);
    if (p.minimumAmount != null && p.maximumAmount != null && num(p.maximumAmount) < num(p.minimumAmount)) {
      throw new ValidationError("Maximum amount must be greater than the minimum amount");
    }
    if (p.effectiveFrom && p.effectiveTo && p.effectiveTo < p.effectiveFrom) {
      throw new ValidationError("Effective To must be on or after Effective From");
    }
  },
  enrich: async (rows) => {
    const [taxes, cats, divs] = await Promise.all([
      nameMap(accTables.taxDefinitions, "tax_name", "tax_code,rate"),
      nameMap(accTables.revenueCategories, "revenue_category_name"),
      nameMap(accTables.divisions, "division_name"),
    ]);
    return rows.map((r) => ({
      ...r,
      taxName: taxes.get(r.taxId)?.taxName ?? null,
      taxCode: taxes.get(r.taxId)?.taxCode ?? null,
      taxRate: taxes.has(r.taxId) ? num(taxes.get(r.taxId)!.rate) : null,
      revenueCategoryName: r.revenueCategoryId ? cats.get(r.revenueCategoryId)?.revenueCategoryName ?? null : null,
      divisionName: r.divisionId ? divs.get(r.divisionId)?.divisionName ?? null : null,
    }));
  },
};

const budgets: MasterConfig = {
  key: "budgets",
  table: accTables.budgets,
  label: "Budget",
  columns: ["fiscalYearId", "divisionId", "budgetAmount", "remarks"],
  required: ["fiscalYearId", "divisionId", "budgetAmount"],
  order: [{ column: "created_at" }],
  filterable: ["fiscalYearId", "divisionId"],
  validate: (p) => assertNonNegative(p, ["budgetAmount"]),
  enrich: async (rows) => {
    const divs = await nameMap(accTables.divisions, "division_name", "division_code");
    return rows.map((r) => ({
      ...r,
      divisionName: divs.get(r.divisionId)?.divisionName ?? null,
      divisionCode: divs.get(r.divisionId)?.divisionCode ?? null,
    }));
  },
};

const fiscalYears: MasterConfig = {
  key: "fiscalYears",
  table: accTables.fiscalYears,
  label: "Fiscal year",
  columns: [
    "companyId", "fiscalYearName", "fyCode", "startDate", "endDate", "carryForwardBalanceSheet",
    "carryForwardCustomers", "carryForwardVendors", "transferPnlToRetainedEarnings", "retainedEarningsAccountId",
  ],
  required: ["startDate", "endDate"],
  order: [{ column: "start_date", ascending: false }],
  filterable: ["status", "companyId"],
  defaults: { status: "Upcoming", isCurrent: false },
  validate: async (p, existing) => {
    const start = p.startDate ?? existing?.startDate;
    const end = p.endDate ?? existing?.endDate;
    if (!isIsoDate(start) || !isIsoDate(end)) throw new ValidationError("Start and end dates are required");
    if (end <= start) throw new ValidationError("End date must be after the start date");
    if (existing && existing.status !== "Upcoming" && (p.startDate || p.endDate)) {
      if (p.startDate !== existing.startDate || p.endDate !== existing.endDate) {
        throw new ConflictError("Dates can only be changed while the fiscal year is Upcoming");
      }
    }
    const years = await list(accTables.fiscalYears, { select: "id,fiscal_year_name,start_date,end_date" });
    const clash = years.find((y) => y.id !== existing?.id && y.startDate <= end && y.endDate >= start);
    if (clash) throw new ConflictError(`Dates overlap with ${clash.fiscalYearName}`);
    if (!p.fyCode && !existing?.fyCode) p.fyCode = `${start.slice(2, 4)}-${end.slice(2, 4)}`;
    if (!p.fiscalYearName && !existing?.fiscalYearName) p.fiscalYearName = `FY ${start.slice(0, 4)}-${end.slice(2, 4)}`;
  },
  afterCreate: async (row) => {
    await generatePeriodsForYear(row as { id: string; startDate: string; endDate: string });
  },
  beforeDelete: async (row) => {
    if (row.status !== "Upcoming") throw new ConflictError("Only Upcoming fiscal years can be deleted");
    await blockIfUsed(accTables.vouchers, "fiscal_year_id", row.id, "Fiscal year has vouchers");
  },
  enrich: async (rows) => {
    const [logs, periods, vouchers] = await Promise.all([
      list(accTables.auditLogs, { eq: { entity_type: "fiscal_year" }, order: [{ column: "created_at", ascending: false }] }),
      list(accTables.fiscalPeriods, { select: "fiscal_year_id,status" }),
      usageCounts(accTables.vouchers, "fiscalYearId"),
    ]);
    return rows.map((r) => {
      const ps = periods.filter((x) => x.fiscalYearId === r.id);
      return {
        ...r,
        totalPeriods: ps.length,
        closedPeriods: ps.filter((x) => x.status === "Closed").length,
        voucherCount: vouchers.get(r.id) ?? 0,
        auditLogs: logs
          .filter((l) => l.entityId === r.id)
          .map((l) => ({ id: l.id, action: l.action, actor: l.actor, reason: l.reason, at: l.createdAt })),
      };
    });
  },
};

const CLOSING_STOCK_COLUMNS = [
  "valuationDate", "storeName", "valuationMethod", "itemCode", "itemName", "category", "uom", "sysQty",
  "physicalQty", "unitRate", "prevPeriodValue", "stockAccountId", "consumptionAccountId", "status",
  "lastAuditDate",
] as const;

const closingStock: MasterConfig = {
  key: "closingStock",
  table: accTables.closingStock,
  label: "Closing stock item",
  columns: CLOSING_STOCK_COLUMNS,
  required: ["valuationDate", "storeName", "itemCode", "itemName"],
  uppercase: ["itemCode"],
  order: [{ column: "valuation_date", ascending: false }, { column: "store_name" }, { column: "item_code" }],
  filterable: ["valuationDate", "storeName", "status"],
  validate: (p, existing) => {
    if (existing?.status === "GL Posted") throw new ConflictError("Item is already posted to the GL");
    if (p.status === "GL Posted") throw new ValidationError("Use the post action to post closing stock");
    assertNonNegative(p, ["sysQty", "physicalQty", "unitRate", "prevPeriodValue"]);
  },
  beforeDelete: async (row) => {
    if (row.status === "GL Posted") throw new ConflictError("Posted closing stock cannot be deleted");
  },
  enrich: async (rows) => {
    const accs = await nameMap(accTables.accounts, "name", "code");
    return rows.map((r) => {
      const total = round2(num(r.physicalQty) * num(r.unitRate));
      return {
        ...r,
        totalValuation: total,
        varianceQty: round2(num(r.physicalQty) - num(r.sysQty)),
        varianceValue: round2((num(r.physicalQty) - num(r.sysQty)) * num(r.unitRate)),
        changeFromPrev: round2(total - num(r.prevPeriodValue)),
        stockAccountName: r.stockAccountId ? accs.get(r.stockAccountId)?.name ?? null : null,
        consumptionAccountName: r.consumptionAccountId ? accs.get(r.consumptionAccountId)?.name ?? null : null,
      };
    });
  },
};

export const masters: Record<string, MasterConfig> = {
  currencies,
  companies,
  accounts,
  divisions,
  partyTypes,
  partySubTypes,
  paymentMethods,
  parties,
  voucherTypes,
  revenueCategories,
  taxDefinitions,
  taxRules,
  budgets,
  fiscalYears,
  closingStock,
};

// ---------------------------------------------------------------------------
// Generic operations
// ---------------------------------------------------------------------------

function normalize(cfg: MasterConfig, body: Row): Row {
  const payload = cleanPayload(body, cfg.columns);
  for (const f of cfg.uppercase ?? []) {
    if (typeof payload[f] === "string") payload[f] = payload[f].toUpperCase();
  }
  return payload;
}

async function enrichRows(cfg: MasterConfig, rows: Row[]): Promise<Row[]> {
  return cfg.enrich ? cfg.enrich(rows) : rows;
}

export async function listMaster(cfg: MasterConfig, query: Record<string, unknown>): Promise<Row[]> {
  const eq: Record<string, string | boolean> = {};
  for (const f of cfg.filterable ?? []) {
    const v = query[f];
    if (typeof v !== "string" || v === "" || v === "all") continue;
    const snake = f.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
    eq[snake] = v === "true" ? true : v === "false" ? false : v;
  }
  let rows = await list(cfg.table, { eq, order: cfg.order });
  const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
  if (search) {
    rows = rows.filter((r) =>
      Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(search)),
    );
  }
  return enrichRows(cfg, rows);
}

export async function getMaster(cfg: MasterConfig, id: string): Promise<Row> {
  requireUuid(id);
  const row = await mustGet(cfg.table, id, cfg.label);
  return (await enrichRows(cfg, [row]))[0];
}

export async function createMaster(cfg: MasterConfig, body: Row): Promise<Row> {
  const payload = { ...(cfg.defaults ?? {}), ...normalize(cfg, body) };
  if (cfg.autoCode && !payload[cfg.autoCode.field]) {
    payload[cfg.autoCode.field] = await nextCode(cfg.table, cfg.autoCode.field, cfg.autoCode.prefix, cfg.autoCode.pad);
  }
  await cfg.validate?.(payload, null);
  const missing = cfg.required.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === "");
  if (missing.length) {
    throw new ValidationError(
      `${cfg.label}: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required`,
      missing.map((m) => ({ path: m, message: `${m} is required` })),
    );
  }
  const hasCreatedBy = !["budgets", "fiscalPeriods", "companySettings"].includes(cfg.key);
  if (hasCreatedBy) payload.createdBy = await actorName();
  const row = await insert(cfg.table, payload);
  await cfg.afterCreate?.(row);
  await cfg.afterSave?.(row);
  return getMaster(cfg, row.id);
}

export async function updateMaster(cfg: MasterConfig, id: string, body: Row): Promise<Row> {
  requireUuid(id);
  const existing = await mustGet(cfg.table, id, cfg.label);
  const payload = normalize(cfg, body);
  await cfg.validate?.(payload, existing);
  for (const f of cfg.required) {
    if (f in payload && (payload[f] === null || payload[f] === "")) {
      throw new ValidationError(`${f} is required`, [{ path: f, message: `${f} is required` }]);
    }
  }
  const hasUpdatedBy = !["budgets", "closingStock"].includes(cfg.key);
  if (hasUpdatedBy) payload.updatedBy = await actorName();
  const row = await update(cfg.table, id, payload);
  await cfg.afterSave?.(row);
  return getMaster(cfg, id);
}

export async function deleteMaster(cfg: MasterConfig, id: string): Promise<{ id: string }> {
  requireUuid(id);
  const existing = await mustGet(cfg.table, id, cfg.label);
  await cfg.beforeDelete?.(existing);
  await remove(cfg.table, id);
  return { id };
}

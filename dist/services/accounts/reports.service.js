import { accTables, isIsoDate, isUuid, list, mustGet, num, round2, todayIso, } from "../../models/accounts/repo.js";
import { ValidationError } from "../../errors/index.js";
import { addDays, buildTree, drCr, isDebitNature, loadAccounts, loadLines, naturalBalance, previousDay, sectionOf, sumByAccount, } from "./ledger.service.js";
import { currentFiscalYear, findFiscalYear } from "./fiscal.service.js";
import { loadBills } from "./bills.service.js";
import { listVouchers } from "./vouchers.service.js";
const PNL_NATURES = new Set(["Income", "Expense"]);
/** Resolve a report window: explicit from/to, else the current fiscal year up to today. */
async function resolveRange(query) {
    let from = isIsoDate(query.from) ? query.from : undefined;
    let to = isIsoDate(query.to) ? query.to : undefined;
    let fy = null;
    if (isUuid(query.fiscalYearId)) {
        const selected = await mustGet(accTables.fiscalYears, query.fiscalYearId, "Fiscal year");
        fy = selected;
        from = from ?? selected.startDate;
        to = to ?? (selected.endDate < todayIso() ? selected.endDate : todayIso());
    }
    if (!from || !to) {
        fy = fy ?? (await currentFiscalYear());
        from = from ?? fy?.startDate ?? `${todayIso().slice(0, 4)}-04-01`;
        to = to ?? todayIso();
    }
    const f = from;
    const t = to;
    if (t < f)
        throw new ValidationError("'to' date must be on or after 'from' date");
    if (!fy)
        fy = await findFiscalYear(f);
    return { from: f, to: t, fiscalYear: fy };
}
function retainedEarningsAccount(accounts, fy) {
    if (fy?.retainedEarningsAccountId) {
        const a = accounts.find((x) => x.id === fy.retainedEarningsAccountId);
        if (a)
            return a;
    }
    return (accounts.find((a) => a.accountType === "Ledger" && /retained|reserve/i.test(a.name)) ??
        accounts.find((a) => a.accountType === "Ledger" && a.reportSection === "Capital & Reserves"));
}
function flatten(nodes, out = []) {
    for (const n of nodes) {
        out.push(n);
        flatten(n.children, out);
    }
    return out;
}
// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------
export async function trialBalance(query) {
    const { from, to, fiscalYear } = await resolveRange(query);
    const fyStart = fiscalYear?.startDate && fiscalYear.startDate <= from ? fiscalYear.startDate : from;
    const [accounts, before, period] = await Promise.all([
        loadAccounts(),
        loadLines({ to: previousDay(from) }),
        loadLines({ from, to }),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const re = retainedEarningsAccount(accounts, fiscalYear);
    const openingLines = [];
    let priorPnl = 0;
    for (const l of before) {
        const acc = byId.get(l.accountId);
        if (acc && PNL_NATURES.has(acc.nature) && l.voucherDate < fyStart) {
            priorPnl += l.debit - l.credit;
            continue;
        }
        openingLines.push(l);
    }
    const opening = sumByAccount(openingLines);
    if (re && Math.abs(priorPnl) > 0.004) {
        const b = opening.get(re.id) ?? { debit: 0, credit: 0, net: 0 };
        b.net = round2(b.net + priorPnl);
        opening.set(re.id, b);
    }
    const movement = sumByAccount(period);
    const openTree = buildTree(accounts, new Map([...opening].map(([k, v]) => [k, { debit: v.net > 0 ? v.net : 0, credit: v.net < 0 ? -v.net : 0, net: v.net }])));
    const moveTree = buildTree(accounts, movement);
    const openFlat = new Map(flatten(openTree).map((n) => [n.id, n.net]));
    const moveFlat = new Map(flatten(moveTree).map((n) => [n.id, n]));
    const showZero = query.showZero === "true";
    const rows = flatten(moveTree)
        .map((n) => {
        const openNet = openFlat.get(n.id) ?? 0;
        const mv = moveFlat.get(n.id);
        const closeNet = round2(openNet + mv.debit - mv.credit);
        return {
            accountId: n.id,
            parentId: n.parentId,
            code: n.code,
            name: n.name,
            accountType: n.accountType,
            nature: n.nature,
            level: n.level,
            openingDebit: openNet > 0 ? round2(openNet) : 0,
            openingCredit: openNet < 0 ? round2(-openNet) : 0,
            debit: mv.debit,
            credit: mv.credit,
            closingDebit: closeNet > 0 ? closeNet : 0,
            closingCredit: closeNet < 0 ? -closeNet : 0,
        };
    })
        .filter((r) => showZero ||
        r.openingDebit || r.openingCredit || r.debit || r.credit || r.closingDebit || r.closingCredit);
    const ledgers = rows.filter((r) => r.accountType === "Ledger");
    const sum = (k) => round2(ledgers.reduce((s, r) => s + num(r[k]), 0));
    const totals = {
        openingDebit: sum("openingDebit"),
        openingCredit: sum("openingCredit"),
        debit: sum("debit"),
        credit: sum("credit"),
        closingDebit: sum("closingDebit"),
        closingCredit: sum("closingCredit"),
    };
    return {
        from,
        to,
        rows,
        totals,
        balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01,
        difference: round2(totals.closingDebit - totals.closingCredit),
    };
}
// ---------------------------------------------------------------------------
// Profit & loss
// ---------------------------------------------------------------------------
const PNL_SECTIONS = ["Direct Income", "Indirect Income", "Direct Expenses", "Indirect Expenses"];
function shiftYear(iso, years) {
    const y = parseInt(iso.slice(0, 4), 10) + years;
    const md = iso.slice(5);
    if (md === "02-29")
        return `${y}-02-28`;
    return `${y}-${md}`;
}
function pnlBySection(accounts, lines) {
    const sections = sectionOf(accounts);
    const bal = sumByAccount(lines);
    const amounts = new Map();
    for (const a of accounts) {
        if (a.accountType !== "Ledger" || !PNL_NATURES.has(a.nature))
            continue;
        const b = bal.get(a.id);
        if (!b)
            continue;
        amounts.set(a.id, naturalBalance(a.nature, b.net));
    }
    return { sections, amounts };
}
export async function profitLoss(query) {
    const { from, to } = await resolveRange(query);
    const prevFrom = isIsoDate(query.compareFrom) ? query.compareFrom : shiftYear(from, -1);
    const prevTo = isIsoDate(query.compareTo) ? query.compareTo : shiftYear(to, -1);
    const [accounts, lines, prevLines, divisions] = await Promise.all([
        loadAccounts(),
        loadLines({ from, to }),
        loadLines({ from: prevFrom, to: prevTo }),
        list(accTables.divisions, { select: "id,division_name,division_code" }),
    ]);
    const cur = pnlBySection(accounts, lines);
    const prev = pnlBySection(accounts, prevLines);
    const sections = PNL_SECTIONS.map((section) => {
        const accs = accounts
            .filter((a) => a.accountType === "Ledger" && PNL_NATURES.has(a.nature) && cur.sections.get(a.id) === section)
            .map((a) => ({
            accountId: a.id,
            code: a.code,
            name: a.name,
            category: a.category,
            amount: cur.amounts.get(a.id) ?? 0,
            previousAmount: prev.amounts.get(a.id) ?? 0,
        }))
            .filter((a) => a.amount !== 0 || a.previousAmount !== 0);
        return {
            section,
            accounts: accs,
            total: round2(accs.reduce((s, a) => s + a.amount, 0)),
            previousTotal: round2(accs.reduce((s, a) => s + a.previousAmount, 0)),
        };
    });
    const t = (name, key = "total") => sections.find((s) => s.section === name)[key];
    const byCat = (cat) => round2(accounts
        .filter((a) => a.category === cat && a.accountType === "Ledger")
        .reduce((s, a) => s + (cur.amounts.get(a.id) ?? 0), 0));
    const directIncome = t("Direct Income");
    const indirectIncome = t("Indirect Income");
    const directExpenses = t("Direct Expenses");
    const indirectExpenses = t("Indirect Expenses");
    const totalRevenue = round2(directIncome + indirectIncome);
    const grossProfit = round2(directIncome - directExpenses);
    const financeCosts = byCat("Finance Costs");
    const netProfit = round2(totalRevenue - directExpenses - indirectExpenses);
    const prevNet = round2(t("Direct Income", "previousTotal") + t("Indirect Income", "previousTotal") -
        t("Direct Expenses", "previousTotal") - t("Indirect Expenses", "previousTotal"));
    const categories = new Map();
    for (const a of accounts) {
        const amt = cur.amounts.get(a.id);
        if (!amt)
            continue;
        const key = `${a.nature}|${a.category}`;
        const c = categories.get(key) ?? { category: a.category, nature: a.nature, amount: 0 };
        c.amount = round2(c.amount + amt);
        categories.set(key, c);
    }
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const monthly = new Map();
    const byDivision = new Map();
    const divName = new Map(divisions.map((d) => [d.id, d.divisionName]));
    for (const l of lines) {
        const a = accById.get(l.accountId);
        if (!a || !PNL_NATURES.has(a.nature))
            continue;
        const amt = naturalBalance(a.nature, l.debit - l.credit);
        const month = l.voucherDate.slice(0, 7);
        const m = monthly.get(month) ?? { month, income: 0, expense: 0, net: 0 };
        const dk = l.divisionId ?? "none";
        const d = byDivision.get(dk) ?? { divisionId: l.divisionId, divisionName: l.divisionId ? divName.get(l.divisionId) ?? "—" : "Unallocated", income: 0, expense: 0 };
        if (a.nature === "Income") {
            m.income = round2(m.income + amt);
            d.income = round2(d.income + amt);
        }
        else {
            m.expense = round2(m.expense + amt);
            d.expense = round2(d.expense + amt);
        }
        m.net = round2(m.income - m.expense);
        monthly.set(month, m);
        byDivision.set(dk, d);
    }
    const pct = (a, b) => (b ? round2((a / b) * 100) : 0);
    return {
        from,
        to,
        compareFrom: prevFrom,
        compareTo: prevTo,
        sections,
        summary: {
            totalRevenue,
            directIncome,
            indirectIncome,
            directExpenses,
            indirectExpenses,
            totalExpenses: round2(directExpenses + indirectExpenses),
            grossProfit,
            grossMargin: pct(grossProfit, directIncome),
            operatingProfit: round2(grossProfit - (indirectExpenses - financeCosts)),
            financeCosts,
            netProfit,
            netMargin: pct(netProfit, totalRevenue),
            previousNetProfit: prevNet,
            netProfitChange: pct(netProfit - prevNet, Math.abs(prevNet)),
            roomRevenue: byCat("Room Revenue"),
            foodRevenue: byCat("Food Revenue"),
            beverageRevenue: byCat("Beverage Revenue"),
            banquetRevenue: byCat("Banquet Revenue"),
            otherOperatingRevenue: byCat("Other Operating Revenue"),
            otherIncome: byCat("Other Income"),
            costOfSales: byCat("Cost of Sales"),
            payroll: byCat("Payroll"),
            utilities: byCat("Utilities"),
            repairsMaintenance: byCat("Repairs & Maintenance"),
            salesMarketing: byCat("Sales & Marketing"),
            administrative: byCat("Administrative & General"),
            commission: byCat("Commission"),
        },
        categories: [...categories.values()],
        monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
        divisions: [...byDivision.values()].map((d) => ({ ...d, net: round2(d.income - d.expense) })),
    };
}
// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------
const BS_ASSET_SECTIONS = ["Fixed Assets", "Current Assets"];
const BS_LIABILITY_SECTIONS = ["Capital & Reserves", "Non-Current Liabilities", "Current Liabilities"];
async function balanceSheetAt(asOn, accounts) {
    const fy = await findFiscalYear(asOn);
    const lines = await loadLines({ to: asOn });
    const bal = sumByAccount(lines);
    const sections = sectionOf(accounts);
    let currentYearProfit = 0;
    let priorProfit = 0;
    const fyStart = fy?.startDate ?? `${asOn.slice(0, 4)}-04-01`;
    for (const l of lines) {
        const a = accounts.find((x) => x.id === l.accountId);
        if (!a || !PNL_NATURES.has(a.nature))
            continue;
        const signed = l.credit - l.debit;
        if (l.voucherDate >= fyStart)
            currentYearProfit += signed;
        else
            priorProfit += signed;
    }
    const amountOf = (a) => {
        const b = bal.get(a.id);
        return b ? naturalBalance(a.nature, b.net) : 0;
    };
    return {
        fy,
        bal,
        sections,
        amountOf,
        currentYearProfit: round2(currentYearProfit),
        priorProfit: round2(priorProfit),
    };
}
export async function balanceSheet(query) {
    const asOn = isIsoDate(query.asOn) ? query.asOn : isIsoDate(query.to) ? query.to : todayIso();
    const compareAsOn = isIsoDate(query.compareAsOn) ? query.compareAsOn : shiftYear(asOn, -1);
    const accounts = await loadAccounts();
    const [cur, prev] = await Promise.all([balanceSheetAt(asOn, accounts), balanceSheetAt(compareAsOn, accounts)]);
    const re = retainedEarningsAccount(accounts, cur.fy);
    const groupsFor = (section) => {
        const ledgers = accounts.filter((a) => a.accountType === "Ledger" && !PNL_NATURES.has(a.nature) && cur.sections.get(a.id) === section);
        const byParent = new Map();
        for (const a of ledgers) {
            let amount = cur.amountOf(a);
            let previousAmount = prev.amountOf(a);
            if (re && a.id === re.id) {
                amount = round2(amount + cur.priorProfit);
                previousAmount = round2(previousAmount + prev.priorProfit);
            }
            if (amount === 0 && previousAmount === 0)
                continue;
            const parent = accounts.find((p) => p.id === a.parentId);
            const key = parent?.id ?? "root";
            const g = byParent.get(key) ?? { groupId: parent?.id ?? null, groupName: parent?.name ?? section, accounts: [] };
            g.accounts.push({ accountId: a.id, code: a.code, name: a.name, amount, previousAmount });
            byParent.set(key, g);
        }
        const groups = [...byParent.values()].map((g) => ({
            ...g,
            total: round2(g.accounts.reduce((s, x) => s + x.amount, 0)),
            previousTotal: round2(g.accounts.reduce((s, x) => s + x.previousAmount, 0)),
        }));
        if (section === "Capital & Reserves") {
            groups.push({
                groupId: null,
                groupName: "Profit & Loss A/c (current year)",
                accounts: [],
                total: cur.currentYearProfit,
                previousTotal: prev.currentYearProfit,
            });
        }
        return {
            section,
            groups,
            total: round2(groups.reduce((s, g) => s + g.total, 0)),
            previousTotal: round2(groups.reduce((s, g) => s + g.previousTotal, 0)),
        };
    };
    const assets = BS_ASSET_SECTIONS.map(groupsFor);
    const liabilities = BS_LIABILITY_SECTIONS.map(groupsFor);
    const totalAssets = round2(assets.reduce((s, x) => s + x.total, 0));
    const totalLiabilities = round2(liabilities.reduce((s, x) => s + x.total, 0));
    const prevAssets = round2(assets.reduce((s, x) => s + x.previousTotal, 0));
    const prevLiabilities = round2(liabilities.reduce((s, x) => s + x.previousTotal, 0));
    const sec = (arr, name) => arr.find((s) => s.section === name)?.total ?? 0;
    const currentAssets = sec(assets, "Current Assets");
    const currentLiabilities = sec(liabilities, "Current Liabilities");
    const equity = sec(liabilities, "Capital & Reserves");
    const stock = round2(accounts
        .filter((a) => a.accountType === "Ledger" && a.category === "Stock")
        .reduce((s, a) => s + cur.amountOf(a), 0));
    return {
        asOn,
        compareAsOn,
        assets,
        liabilities,
        totals: {
            totalAssets,
            totalLiabilities,
            previousTotalAssets: prevAssets,
            previousTotalLiabilities: prevLiabilities,
            difference: round2(totalAssets - totalLiabilities),
            balanced: Math.abs(totalAssets - totalLiabilities) < 0.01,
        },
        ratios: {
            currentRatio: currentLiabilities ? round2(currentAssets / currentLiabilities) : null,
            quickRatio: currentLiabilities ? round2((currentAssets - stock) / currentLiabilities) : null,
            debtEquity: equity ? round2((totalLiabilities - equity) / equity) : null,
            workingCapital: round2(currentAssets - currentLiabilities),
        },
    };
}
// ---------------------------------------------------------------------------
// General ledger / party ledger
// ---------------------------------------------------------------------------
export async function generalLedger(query) {
    const accountId = isUuid(query.accountId) ? query.accountId : undefined;
    const partyId = isUuid(query.partyId) ? query.partyId : undefined;
    if (!accountId && !partyId)
        throw new ValidationError("Select an account or a party");
    const { from, to, fiscalYear } = await resolveRange(query);
    const [accounts, parties, divisions, types] = await Promise.all([
        loadAccounts(),
        list(accTables.parties, { select: "id,party_code,party_name" }),
        list(accTables.divisions, { select: "id,division_name" }),
        list(accTables.voucherTypes, { select: "id,voucher_type_name,short_code" }),
    ]);
    const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;
    if (accountId && !account)
        throw new ValidationError("Account not found");
    const accIds = account
        ? account.accountType === "Group"
            ? descendantLedgers(accounts, account.id)
            : [account.id]
        : undefined;
    const [before, inRange] = await Promise.all([
        loadLines({ to: previousDay(from), accountIds: accIds, partyId }),
        loadLines({ from, to }),
    ]);
    const isPnl = account ? PNL_NATURES.has(account.nature) : false;
    const fyStart = fiscalYear?.startDate ?? from;
    const openingNet = round2(before
        .filter((l) => !isPnl || l.voucherDate >= fyStart)
        .filter((l) => !isUuid(query.divisionId) || l.divisionId === query.divisionId)
        .reduce((s, l) => s + l.debit - l.credit, 0));
    const accSet = accIds ? new Set(accIds) : null;
    const matches = (l) => (!accSet || accSet.has(l.accountId)) &&
        (!partyId || l.partyId === partyId) &&
        (!isUuid(query.divisionId) || l.divisionId === query.divisionId) &&
        (!isUuid(query.voucherTypeId) || l.voucherTypeId === query.voucherTypeId);
    const byVoucher = new Map();
    for (const l of inRange) {
        const arr = byVoucher.get(l.voucherId) ?? [];
        arr.push(l);
        byVoucher.set(l.voucherId, arr);
    }
    const accName = new Map(accounts.map((a) => [a.id, a.name]));
    const partyName = new Map(parties.map((p) => [p.id, p.partyName]));
    const divName = new Map(divisions.map((d) => [d.id, d.divisionName]));
    const typeName = new Map(types.map((t) => [t.id, t]));
    let running = openingNet;
    const entries = inRange.filter(matches).map((l) => {
        running = round2(running + l.debit - l.credit);
        const contra = (byVoucher.get(l.voucherId) ?? [])
            .filter((o) => o.id !== l.id && (l.debit > 0 ? o.credit > 0 : o.debit > 0))
            .map((o) => accName.get(o.accountId))
            .filter(Boolean);
        const vt = typeName.get(l.voucherTypeId);
        return {
            lineId: l.id,
            voucherId: l.voucherId,
            voucherNo: l.voucherNo,
            voucherDate: l.voucherDate,
            voucherType: vt?.voucherTypeName ?? l.voucherCategory,
            voucherTypeCode: vt?.shortCode ?? null,
            accountName: accName.get(l.accountId) ?? null,
            particulars: [...new Set(contra)].join(", ") || l.voucherNarration,
            narration: l.narration || l.voucherNarration,
            referenceNo: l.referenceNo,
            chequeNo: l.chequeNo || l.instrumentNo,
            partyName: l.partyId ? partyName.get(l.partyId) ?? null : null,
            divisionName: l.divisionId ? divName.get(l.divisionId) ?? null : null,
            debit: l.debit,
            credit: l.credit,
            balance: Math.abs(running),
            balanceSide: running >= 0 ? "Dr" : "Cr",
        };
    });
    const totalDebit = round2(entries.reduce((s, e) => s + e.debit, 0));
    const totalCredit = round2(entries.reduce((s, e) => s + e.credit, 0));
    const party = partyId ? parties.find((p) => p.id === partyId) : undefined;
    return {
        from,
        to,
        account: account ? { id: account.id, code: account.code, name: account.name, nature: account.nature, accountType: account.accountType } : null,
        party: party ? { id: party.id, code: party.partyCode, name: party.partyName } : null,
        opening: { ...drCr(openingNet), net: openingNet },
        entries,
        totals: { debit: totalDebit, credit: totalCredit },
        closing: { ...drCr(running), net: running },
    };
}
function descendantLedgers(accounts, groupId) {
    const out = [];
    const walk = (id) => {
        for (const a of accounts.filter((x) => x.parentId === id)) {
            if (a.accountType === "Ledger")
                out.push(a.id);
            else
                walk(a.id);
        }
    };
    walk(groupId);
    return out;
}
// ---------------------------------------------------------------------------
// Day book
// ---------------------------------------------------------------------------
export async function dayBook(query) {
    const date = isIsoDate(query.date) ? query.date : undefined;
    const from = date ?? (isIsoDate(query.from) ? query.from : todayIso());
    const to = date ?? (isIsoDate(query.to) ? query.to : from);
    const status = typeof query.status === "string" && query.status ? query.status : "Posted";
    const [vouchers, accounts, before, inRange] = await Promise.all([
        listVouchers({ from, to, status, voucherTypeId: query.voucherTypeId, category: query.category }),
        loadAccounts(),
        loadLines({ to: previousDay(from) }),
        loadLines({ from, to }),
    ]);
    const cashBank = new Set(accounts.filter((a) => a.isBankAccount || a.isCashAccount).map((a) => a.id));
    const cash = new Set(accounts.filter((a) => a.isCashAccount).map((a) => a.id));
    const sumNet = (lines, set) => round2(lines.filter((l) => set.has(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0));
    const inflow = round2(inRange.filter((l) => cashBank.has(l.accountId)).reduce((s, l) => s + l.debit, 0));
    const outflow = round2(inRange.filter((l) => cashBank.has(l.accountId)).reduce((s, l) => s + l.credit, 0));
    const opening = sumNet(before, cashBank);
    const byCategory = new Map();
    for (const v of vouchers) {
        const c = byCategory.get(v.voucherCategory) ?? { category: v.voucherCategory, count: 0, amount: 0 };
        c.count++;
        c.amount = round2(c.amount + num(v.totalAmount));
        byCategory.set(v.voucherCategory, c);
    }
    return {
        from,
        to,
        vouchers,
        summary: {
            voucherCount: vouchers.length,
            totalDebit: round2(vouchers.reduce((s, v) => s + v.lines.reduce((x, l) => x + num(l.debit), 0), 0)),
            totalCredit: round2(vouchers.reduce((s, v) => s + v.lines.reduce((x, l) => x + num(l.credit), 0), 0)),
            openingCashBank: opening,
            inflow,
            outflow,
            closingCashBank: round2(opening + inflow - outflow),
            openingCash: sumNet(before, cash),
            closingCash: round2(sumNet(before, cash) + sumNet(inRange, cash)),
            byCategory: [...byCategory.values()],
        },
    };
}
// ---------------------------------------------------------------------------
// Outstanding / aging
// ---------------------------------------------------------------------------
function parseSlabs(v) {
    const raw = typeof v === "string" && v.trim() ? v.split(",").map((s) => parseInt(s.trim(), 10)) : [30, 60, 90, 180];
    const slabs = [...new Set(raw.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    if (slabs.length === 0)
        throw new ValidationError("Provide at least one aging slab in days");
    return slabs;
}
function bucketLabels(slabs) {
    const labels = [];
    let prev = 0;
    for (const s of slabs) {
        labels.push(prev === 0 ? `0-${s}` : `${prev + 1}-${s}`);
        prev = s;
    }
    labels.push(`>${prev}`);
    return labels;
}
function bucketIndex(days, slabs) {
    for (let i = 0; i < slabs.length; i++)
        if (days <= slabs[i])
            return i;
    return slabs.length;
}
async function agingBase(query) {
    const asOnDate = isIsoDate(query.asOnDate) ? query.asOnDate : todayIso();
    const slabs = parseSlabs(query.slabs);
    const ageBy = query.ageBy === "dueDate" ? "dueDate" : "billDate";
    const moduleType = query.moduleType === "AP" ? "AP" : "AR";
    const bills = await loadBills({
        moduleType,
        partyId: query.partyId,
        partyGroup: query.partyGroup,
        asOnDate,
        status: "Open",
        pendingOnly: true,
    });
    const labels = bucketLabels(slabs);
    const withBucket = bills.map((b) => {
        const days = ageBy === "dueDate" ? b.overdueDays : b.billAgeDays;
        return { ...b, ageDays: days, bucketIndex: bucketIndex(days, slabs), bucket: labels[bucketIndex(days, slabs)] };
    });
    return { asOnDate, slabs, labels, ageBy, moduleType, bills: withBucket };
}
export async function outstandingBills(query) {
    const base = await agingBase(query);
    const totals = base.labels.map((label, i) => ({
        bucket: label,
        amount: round2(base.bills.filter((b) => b.bucketIndex === i).reduce((s, b) => s + b.balance, 0)),
        count: base.bills.filter((b) => b.bucketIndex === i).length,
    }));
    return {
        ...base,
        totals,
        totalOutstanding: round2(base.bills.reduce((s, b) => s + b.balance, 0)),
        totalBillAmount: round2(base.bills.reduce((s, b) => s + b.amount, 0)),
    };
}
export async function agingSummary(query) {
    const base = await agingBase(query);
    const partyIds = [...new Set(base.bills.map((b) => b.partyId))];
    const parties = partyIds.length ? await list(accTables.parties, { in: { id: partyIds } }) : [];
    const rows = parties
        .map((p) => {
        const pb = base.bills.filter((b) => b.partyId === p.id);
        const buckets = base.labels.map((_, i) => round2(pb.filter((b) => b.bucketIndex === i).reduce((s, b) => s + b.balance, 0)));
        const total = round2(pb.reduce((s, b) => s + b.balance, 0));
        return {
            partyId: p.id,
            partyCode: p.partyCode,
            partyName: p.partyName,
            partyGroup: p.partyGroup,
            city: p.city,
            creditDays: num(p.creditDays),
            creditLimit: num(p.creditLimit),
            overLimit: num(p.creditLimit) > 0 && total > num(p.creditLimit),
            billsCount: pb.length,
            oldestDays: pb.reduce((m, b) => Math.max(m, b.ageDays), 0),
            buckets,
            total,
        };
    })
        .sort((a, b) => b.total - a.total);
    return {
        asOnDate: base.asOnDate,
        slabs: base.slabs,
        labels: base.labels,
        ageBy: base.ageBy,
        moduleType: base.moduleType,
        rows,
        totals: {
            buckets: base.labels.map((_, i) => round2(rows.reduce((s, r) => s + r.buckets[i], 0))),
            total: round2(rows.reduce((s, r) => s + r.total, 0)),
        },
    };
}
// ---------------------------------------------------------------------------
// Party settlement statement
// ---------------------------------------------------------------------------
export async function partySettlement(query) {
    const asOnDate = isIsoDate(query.to) ? query.to : todayIso();
    const from = isIsoDate(query.from) ? query.from : undefined;
    const bills = await loadBills({
        moduleType: query.moduleType,
        partyId: query.partyId,
        partyGroup: query.partyGroup,
        asOnDate,
        status: "Open",
    });
    const filtered = from ? bills.filter((b) => b.billDate >= from || b.balance > 0) : bills;
    const status = typeof query.status === "string" ? query.status : "all";
    const rows = filtered.filter((b) => status === "pending" ? b.balance > 0 : status === "settled" ? b.balance <= 0 : true);
    const vIds = [...new Set(rows.flatMap((b) => b.settlements.map((s) => s.voucherId).filter(Boolean)))];
    const vouchers = vIds.length ? await list(accTables.vouchers, { in: { id: vIds }, select: "id,voucher_no" }) : [];
    const vNo = new Map(vouchers.map((v) => [v.id, v.voucherNo]));
    return {
        from: from ?? null,
        to: asOnDate,
        bills: rows.map((b) => ({
            ...b,
            settlements: b.settlements.map((s) => ({ ...s, voucherNo: s.voucherId ? vNo.get(s.voucherId) ?? null : null })),
        })),
        totals: {
            billAmount: round2(rows.reduce((s, b) => s + b.amount, 0)),
            settled: round2(rows.reduce((s, b) => s + b.settledAmount, 0)),
            balance: round2(rows.reduce((s, b) => s + b.balance, 0)),
        },
    };
}
// ---------------------------------------------------------------------------
// Reminder letters
// ---------------------------------------------------------------------------
export async function reminderLetters(query) {
    const asOnDate = isIsoDate(query.asOnDate) ? query.asOnDate : todayIso();
    const minOverdue = num(query.minOverdueDays);
    const bills = await loadBills({
        moduleType: "AR",
        partyGroup: query.partyGroup,
        partyId: query.partyId,
        asOnDate,
        status: "Open",
        pendingOnly: true,
    });
    const overdue = bills.filter((b) => b.overdueDays > 0 && b.overdueDays >= minOverdue);
    const partyIds = [...new Set(overdue.map((b) => b.partyId))];
    const parties = partyIds.length ? await list(accTables.parties, { in: { id: partyIds } }) : [];
    return {
        asOnDate,
        parties: parties
            .map((p) => {
            const pb = overdue.filter((b) => b.partyId === p.id);
            return {
                partyId: p.id,
                partyCode: p.partyCode,
                partyName: p.partyName,
                partyGroup: p.partyGroup,
                contactPersonName: p.contactPersonName,
                email: p.email,
                phone: p.phone,
                address: [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode].filter(Boolean).join(", "),
                maxOverdueDays: pb.reduce((m, b) => Math.max(m, b.overdueDays), 0),
                totalOverdue: round2(pb.reduce((s, b) => s + b.balance, 0)),
                bills: pb.map((b) => ({
                    billId: b.id,
                    billNo: b.billNo,
                    billDate: b.billDate,
                    dueDate: b.dueDate,
                    amount: b.amount,
                    balance: b.balance,
                    overdueDays: b.overdueDays,
                    details: b.details,
                })),
            };
        })
            .sort((a, b) => b.totalOverdue - a.totalOverdue),
    };
}
// ---------------------------------------------------------------------------
// Balance confirmation
// ---------------------------------------------------------------------------
export async function balanceConfirmation(query) {
    const { from, to } = await resolveRange(query);
    const [parties, before, period] = await Promise.all([
        list(accTables.parties, { order: [{ column: "party_name" }] }),
        loadLines({ to: previousDay(from) }),
        loadLines({ from, to }),
    ]);
    const group = typeof query.partyGroup === "string" && query.partyGroup !== "all" ? query.partyGroup : null;
    const onlyParty = isUuid(query.partyId) ? query.partyId : null;
    const rows = parties
        .filter((p) => (!group || p.partyGroup === group) && (!onlyParty || p.id === onlyParty))
        .map((p) => {
        const open = round2(before.filter((l) => l.partyId === p.id).reduce((s, l) => s + l.debit - l.credit, 0));
        const pl = period.filter((l) => l.partyId === p.id);
        const debit = round2(pl.reduce((s, l) => s + l.debit, 0));
        const credit = round2(pl.reduce((s, l) => s + l.credit, 0));
        const close = round2(open + debit - credit);
        return {
            partyId: p.id,
            partyCode: p.partyCode,
            partyName: p.partyName,
            partyGroup: p.partyGroup,
            contactPersonName: p.contactPersonName,
            email: p.email,
            address: [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode].filter(Boolean).join(", "),
            gstin: p.gstin,
            opening: { ...drCr(open), net: open },
            debit,
            credit,
            closing: { ...drCr(close), net: close },
        };
    })
        .filter((r) => query.includeZero === "true" || r.opening.net !== 0 || r.debit || r.credit);
    return { from, to, rows };
}
// ---------------------------------------------------------------------------
// Payment advice
// ---------------------------------------------------------------------------
export async function paymentAdvice(query) {
    const { from, to } = await resolveRange(query);
    const vouchers = await listVouchers({ from, to, status: "Posted", category: "Payment", partyId: query.partyId });
    const withParty = vouchers.filter((v) => v.partyId || v.lines.some((l) => l.partyId));
    const ids = withParty.map((v) => v.id);
    const settlements = ids.length ? await list(accTables.billSettlements, { in: { voucher_id: ids } }) : [];
    const billIds = [...new Set(settlements.map((s) => s.billId))];
    const bills = billIds.length ? await list(accTables.partyBills, { in: { id: billIds } }) : [];
    const billById = new Map(bills.map((b) => [b.id, b]));
    const partyIds = [...new Set(withParty.map((v) => (v.partyId ?? v.lines.find((l) => l.partyId)?.partyId)))];
    const parties = partyIds.length ? await list(accTables.parties, { in: { id: partyIds } }) : [];
    const partyById = new Map(parties.map((p) => [p.id, p]));
    return {
        from,
        to,
        advices: withParty.map((v) => {
            const pid = v.partyId ?? v.lines.find((l) => l.partyId)?.partyId;
            const p = partyById.get(pid);
            const alloc = settlements.filter((s) => s.voucherId === v.id);
            return {
                voucherId: v.id,
                voucherNo: v.voucherNo,
                voucherDate: v.voucherDate,
                amount: num(v.totalAmount),
                narration: v.narration,
                referenceNo: v.referenceNo,
                instrumentNo: v.instrumentNo,
                instrumentDate: v.instrumentDate,
                paymentMethodName: v.paymentMethodName,
                bankCashAccountName: v.bankCashAccountName,
                partyId: pid,
                partyName: p?.partyName ?? v.partyName,
                partyCode: p?.partyCode ?? null,
                partyEmail: p?.email ?? "",
                partyAddress: p ? [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode].filter(Boolean).join(", ") : "",
                bankName: p?.bankName ?? "",
                bankAccountNumber: p?.bankAccountNumber ?? "",
                bankIfsc: p?.bankIfsc ?? "",
                bills: alloc.map((s) => {
                    const b = billById.get(s.billId);
                    return {
                        billId: s.billId,
                        billNo: b?.billNo ?? null,
                        billDate: b?.billDate ?? null,
                        billAmount: b ? num(b.amount) : null,
                        paidAmount: num(s.amount),
                        deductions: num(s.deductions),
                    };
                }),
            };
        }),
    };
}
// ---------------------------------------------------------------------------
// Financial analysis
// ---------------------------------------------------------------------------
export async function financialAnalysis(query) {
    const { from, to, fiscalYear } = await resolveRange(query);
    const [pnl, bs, budgets, arAging, apBills] = await Promise.all([
        profitLoss({ from, to }),
        balanceSheet({ asOn: to }),
        fiscalYear ? list(accTables.budgets, { eq: { fiscal_year_id: fiscalYear.id } }) : Promise.resolve([]),
        agingSummary({ asOnDate: to, moduleType: "AR" }),
        loadBills({ moduleType: "AP", asOnDate: to, status: "Open", pendingOnly: true }),
    ]);
    const totalIncome = pnl.summary.totalRevenue;
    const departments = pnl.divisions
        .filter((d) => d.income > 0)
        .map((d) => {
        const budget = budgets.find((b) => b.divisionId === d.divisionId);
        return {
            ...d,
            share: totalIncome ? round2((d.income / totalIncome) * 100) : 0,
            budget: budget ? num(budget.budgetAmount) : null,
        };
    })
        .sort((a, b) => b.income - a.income);
    const fyStart = fiscalYear?.startDate ?? from;
    const quarters = [0, 1, 2, 3].map((q) => {
        const qFrom = addMonths(fyStart, q * 3);
        const qTo = previousDay(addMonths(fyStart, q * 3 + 3));
        const months = pnl.monthly.filter((m) => m.month >= qFrom.slice(0, 7) && m.month <= qTo.slice(0, 7));
        const income = round2(months.reduce((s, m) => s + m.income, 0));
        const expense = round2(months.reduce((s, m) => s + m.expense, 0));
        return { quarter: `Q${q + 1}`, from: qFrom, to: qTo, income, expense, net: round2(income - expense) };
    });
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const receivables = arAging.totals.total;
    const payables = round2(apBills.reduce((s, b) => s + b.balance, 0));
    const purchases = pnl.summary.directExpenses + pnl.summary.indirectExpenses;
    const divisions = await list(accTables.divisions, { select: "id,division_name,division_code" });
    const budgetRows = budgets.map((b) => {
        const actual = pnl.divisions.find((d) => d.divisionId === b.divisionId)?.income ?? 0;
        const div = divisions.find((d) => d.id === b.divisionId);
        const budget = num(b.budgetAmount);
        return {
            budgetId: b.id,
            divisionId: b.divisionId,
            divisionName: div?.divisionName ?? null,
            divisionCode: div?.divisionCode ?? null,
            budget,
            actual,
            variance: round2(actual - budget),
            utilization: budget ? round2((actual / budget) * 100) : 0,
        };
    });
    return {
        from,
        to,
        fiscalYearId: fiscalYear?.id ?? null,
        fiscalYearName: fiscalYear?.fiscalYearName ?? null,
        summary: pnl.summary,
        departments,
        quarterly: quarters,
        monthly: pnl.monthly,
        ratios: {
            grossMargin: pnl.summary.grossMargin,
            netMargin: pnl.summary.netMargin,
            payrollPercent: totalIncome ? round2((pnl.summary.payroll / totalIncome) * 100) : 0,
            costOfSalesPercent: totalIncome ? round2((pnl.summary.costOfSales / totalIncome) * 100) : 0,
            currentRatio: bs.ratios.currentRatio,
            quickRatio: bs.ratios.quickRatio,
            debtEquity: bs.ratios.debtEquity,
            workingCapital: bs.ratios.workingCapital,
            receivableDays: totalIncome ? round2((receivables / totalIncome) * days) : 0,
            payableDays: purchases ? round2((payables / purchases) * days) : 0,
        },
        receivablesAging: { labels: arAging.labels, totals: arAging.totals, topParties: arAging.rows.slice(0, 10) },
        payablesOutstanding: payables,
        budgets: budgetRows,
    };
}
function addMonths(iso, months) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
}
// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export async function dashboard(query) {
    const asOn = isIsoDate(query.asOn) ? query.asOn : todayIso();
    const fy = (await findFiscalYear(asOn)) ?? (await currentFiscalYear());
    const fyStart = fy?.startDate ?? `${asOn.slice(0, 4)}-04-01`;
    const monthStart = `${asOn.slice(0, 7)}-01`;
    const [accounts, allLines, ytdPnl, mtdPnl, arBills, apBills, recent, pendingVouchers, parties] = await Promise.all([
        loadAccounts(),
        loadLines({ to: asOn }),
        profitLoss({ from: fyStart, to: asOn }),
        profitLoss({ from: monthStart, to: asOn }),
        loadBills({ moduleType: "AR", asOnDate: asOn, status: "Open", pendingOnly: true }),
        loadBills({ moduleType: "AP", asOnDate: "9999-12-31", status: "Open", pendingOnly: true }),
        listVouchers({ status: "Posted", to: asOn, limit: 10 }),
        list(accTables.vouchers, { in: { status: ["Draft", "Provisional"] }, select: "id,status" }),
        list(accTables.parties, { select: "id,party_name,party_group" }),
    ]);
    const bal = sumByAccount(allLines);
    const sumAccounts = (pred) => round2(accounts.filter((a) => a.accountType === "Ledger" && pred(a)).reduce((s, a) => s + (bal.get(a.id)?.net ?? 0), 0));
    const bankIds = new Set(accounts.filter((a) => a.isBankAccount).map((a) => a.id));
    const unreconciled = allLines.filter((l) => bankIds.has(l.accountId) && !l.reconciled).length;
    const upcoming = apBills
        .filter((b) => b.dueDate <= addDays(asOn, 30))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 10)
        .map((b) => ({
        billId: b.id,
        partyId: b.partyId,
        partyName: b.partyName,
        billNo: b.billNo,
        billDate: b.billDate,
        dueDate: b.dueDate,
        amount: b.amount,
        balance: b.balance,
        overdueDays: b.overdueDays,
        status: b.overdueDays > 0 ? "Overdue" : b.dueDate === asOn ? "Due Today" : "Upcoming",
    }));
    const partyGroup = new Map(parties.map((p) => [p.id, p.partyGroup]));
    const partyName = new Map(parties.map((p) => [p.id, p.partyName]));
    const roomAccounts = new Set(accounts.filter((a) => a.category === "Room Revenue").map((a) => a.id));
    const channel = new Map();
    const ytdLines = allLines.filter((l) => l.voucherDate >= fyStart);
    const byVoucher = new Map();
    for (const l of ytdLines) {
        const arr = byVoucher.get(l.voucherId) ?? [];
        arr.push(l);
        byVoucher.set(l.voucherId, arr);
    }
    for (const lines of byVoucher.values()) {
        const room = round2(lines.filter((l) => roomAccounts.has(l.accountId)).reduce((s, l) => s + l.credit - l.debit, 0));
        if (!room)
            continue;
        const agent = lines.find((l) => l.partyId && partyGroup.get(l.partyId) === "Travel Agents");
        const corp = lines.find((l) => l.partyId && partyGroup.get(l.partyId) === "Corporate Debtors");
        const key = agent ? partyName.get(agent.partyId) : corp ? "Corporate" : "Direct / Walk-in";
        channel.set(key, round2((channel.get(key) ?? 0) + room));
    }
    return {
        asOn,
        fiscalYearName: fy?.fiscalYearName ?? null,
        kpis: {
            cashBalance: sumAccounts((a) => a.isCashAccount),
            bankBalance: sumAccounts((a) => a.isBankAccount),
            receivables: round2(arBills.reduce((s, b) => s + b.balance, 0)),
            overdueReceivables: round2(arBills.filter((b) => b.overdueDays > 0).reduce((s, b) => s + b.balance, 0)),
            payables: round2(apBills.reduce((s, b) => s + b.balance, 0)),
            revenueMtd: mtdPnl.summary.totalRevenue,
            expensesMtd: mtdPnl.summary.totalExpenses,
            netProfitMtd: mtdPnl.summary.netProfit,
            revenueYtd: ytdPnl.summary.totalRevenue,
            expensesYtd: ytdPnl.summary.totalExpenses,
            netProfitYtd: ytdPnl.summary.netProfit,
            netMarginYtd: ytdPnl.summary.netMargin,
            gstPayable: -sumAccounts((a) => a.category === "Duties & Taxes"),
            draftVouchers: pendingVouchers.filter((v) => v.status === "Draft").length,
            provisionalEntries: pendingVouchers.filter((v) => v.status === "Provisional").length,
            unreconciledBankEntries: unreconciled,
        },
        departmentRevenue: ytdPnl.divisions
            .filter((d) => d.income > 0)
            .map((d) => ({ name: d.divisionName, value: d.income }))
            .sort((a, b) => b.value - a.value),
        channelRevenue: [...channel.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        monthly: ytdPnl.monthly,
        revenueMix: [
            { name: "Rooms", value: ytdPnl.summary.roomRevenue },
            { name: "Food", value: ytdPnl.summary.foodRevenue },
            { name: "Beverage", value: ytdPnl.summary.beverageRevenue },
            { name: "Banquets", value: ytdPnl.summary.banquetRevenue },
            { name: "Other", value: round2(ytdPnl.summary.otherOperatingRevenue + ytdPnl.summary.otherIncome) },
        ].filter((x) => x.value > 0),
        upcomingVendorPayments: upcoming,
        recentVouchers: recent.map((v) => ({
            id: v.id,
            voucherNo: v.voucherNo,
            voucherDate: v.voucherDate,
            voucherTypeName: v.voucherTypeName,
            voucherCategory: v.voucherCategory,
            narration: v.narration,
            partyName: v.partyName,
            totalAmount: v.totalAmount,
            status: v.status,
        })),
    };
}
export { isDebitNature };
//# sourceMappingURL=reports.service.js.map
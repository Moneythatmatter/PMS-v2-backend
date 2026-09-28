import { accTables, list, num, round2 } from "../../models/accounts/repo.js";
const VOUCHER_EMBED = "acc_vouchers!inner(voucher_no,voucher_date,voucher_category,voucher_type_id,status,narration,reference_no,instrument_no)";
export async function loadAccounts() {
    const rows = await list(accTables.accounts, { order: [{ column: "code" }] });
    return rows;
}
/**
 * Posted voucher lines, optionally limited to a date window and/or accounts.
 * `from` / `to` are inclusive ISO dates. `statuses` defaults to Posted only.
 */
export async function loadLines(opts = {}) {
    const statuses = opts.statuses ?? ["Posted"];
    const rows = await list(accTables.voucherLines, {
        select: `*,${VOUCHER_EMBED}`,
        in: {
            "acc_vouchers.status": statuses,
            ...(opts.accountIds ? { account_id: opts.accountIds } : {}),
        },
        eq: opts.partyId ? { party_id: opts.partyId } : {},
        gte: { "acc_vouchers.voucher_date": opts.from },
        lte: { "acc_vouchers.voucher_date": opts.to },
    });
    const lines = rows.map((r) => {
        const v = r.accVouchers ?? {};
        return {
            id: r.id,
            voucherId: r.voucherId,
            voucherNo: v.voucherNo,
            voucherDate: v.voucherDate,
            voucherCategory: v.voucherCategory,
            voucherTypeId: v.voucherTypeId,
            voucherStatus: v.status,
            voucherNarration: v.narration ?? "",
            referenceNo: v.referenceNo ?? "",
            instrumentNo: v.instrumentNo ?? "",
            lineNo: r.lineNo,
            accountId: r.accountId,
            partyId: r.partyId,
            divisionId: r.divisionId,
            debit: num(r.debit),
            credit: num(r.credit),
            narration: r.narration ?? "",
            chequeNo: r.chequeNo ?? "",
            chequeDate: r.chequeDate,
            reconciled: Boolean(r.reconciled),
            reconDate: r.reconDate,
        };
    });
    lines.sort((a, b) => a.voucherDate.localeCompare(b.voucherDate) ||
        a.voucherNo.localeCompare(b.voucherNo) ||
        a.lineNo - b.lineNo);
    return lines;
}
/** Sum debit / credit per account. `net` is debit − credit. */
export function sumByAccount(lines) {
    const out = new Map();
    for (const l of lines) {
        const b = out.get(l.accountId) ?? { debit: 0, credit: 0, net: 0 };
        b.debit += l.debit;
        b.credit += l.credit;
        out.set(l.accountId, b);
    }
    for (const b of out.values()) {
        b.debit = round2(b.debit);
        b.credit = round2(b.credit);
        b.net = round2(b.debit - b.credit);
    }
    return out;
}
export function isDebitNature(nature) {
    return nature === "Asset" || nature === "Expense";
}
/** Balance shown in the account's natural direction (positive = normal). */
export function naturalBalance(nature, net) {
    return round2(isDebitNature(nature) ? net : -net);
}
export function drCr(net) {
    return { amount: round2(Math.abs(net)), side: net >= 0 ? "Dr" : "Cr" };
}
export function previousDay(iso) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
export function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
/** Build the COA tree with balances rolled up from ledgers into their groups. */
export function buildTree(accounts, balances) {
    const nodes = new Map();
    for (const a of accounts) {
        const b = balances.get(a.id) ?? { debit: 0, credit: 0, net: 0 };
        nodes.set(a.id, { ...a, level: 1, children: [], debit: b.debit, credit: b.credit, net: b.net });
    }
    const roots = [];
    for (const n of nodes.values()) {
        const parent = n.parentId ? nodes.get(n.parentId) : undefined;
        if (parent)
            parent.children.push(n);
        else
            roots.push(n);
    }
    const roll = (n, level) => {
        n.level = level;
        n.children.sort((a, b) => a.code.localeCompare(b.code));
        for (const c of n.children) {
            roll(c, level + 1);
            n.debit += c.debit;
            n.credit += c.credit;
        }
        n.debit = round2(n.debit);
        n.credit = round2(n.credit);
        n.net = round2(n.debit - n.credit);
    };
    roots.sort((a, b) => a.code.localeCompare(b.code));
    for (const r of roots)
        roll(r, 1);
    return roots;
}
/** Map every account id to its top-level ancestor's report section (falls back to own section). */
export function sectionOf(accounts) {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const out = new Map();
    for (const a of accounts) {
        let section = a.reportSection;
        let cur = a;
        while (!section && cur?.parentId) {
            cur = byId.get(cur.parentId);
            section = cur?.reportSection ?? "";
        }
        out.set(a.id, section || a.nature);
    }
    return out;
}
//# sourceMappingURL=ledger.service.js.map
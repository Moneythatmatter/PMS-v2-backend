import { accTables, actorName, audit, cleanPayload, daysBetween, getById, insert, insertMany, isIsoDate, isUuid, list, mustGet, num, remove, requireUuid, round2, todayIso, update, } from "../../models/accounts/repo.js";
import { ConflictError, ValidationError } from "../../errors/index.js";
import { addDays } from "./ledger.service.js";
const BILL_COLUMNS = [
    "partyId", "moduleType", "refType", "billNo", "billDate", "dueDate", "amount", "details", "voucherId",
    "divisionId", "remarks",
];
/** Bills with settlement totals as on a date (defaults to today). */
export async function loadBills(query = {}) {
    const asOn = isIsoDate(query.asOnDate) ? query.asOnDate : todayIso();
    const [bills, settlements, parties] = await Promise.all([
        list(accTables.partyBills, {
            eq: {
                module_type: query.moduleType === "AR" || query.moduleType === "AP" ? query.moduleType : undefined,
                party_id: isUuid(query.partyId) ? query.partyId : undefined,
                status: query.status && query.status !== "all" ? query.status : undefined,
            },
            in: query.partyIds ? { party_id: query.partyIds } : {},
            lte: { bill_date: query.billTo && isIsoDate(query.billTo) ? query.billTo : asOn },
            gte: { bill_date: isIsoDate(query.billFrom) ? query.billFrom : undefined },
            order: [{ column: "bill_date" }, { column: "bill_no" }],
        }),
        list(accTables.billSettlements, { lte: { settlement_date: asOn }, order: [{ column: "settlement_date" }] }),
        list(accTables.parties, { select: "id,party_code,party_name,party_group,credit_days" }),
    ]);
    const partyById = new Map(parties.map((p) => [p.id, p]));
    const settledBy = new Map();
    for (const s of settlements) {
        const arr = settledBy.get(s.billId) ?? [];
        arr.push({ ...s, amount: num(s.amount), deductions: num(s.deductions) });
        settledBy.set(s.billId, arr);
    }
    const out = [];
    for (const b of bills) {
        const party = partyById.get(b.partyId);
        if (query.partyGroup && query.partyGroup !== "all" && party?.partyGroup !== query.partyGroup)
            continue;
        const ss = settledBy.get(b.id) ?? [];
        const settled = round2(ss.reduce((s, x) => s + x.amount + x.deductions, 0));
        const amount = num(b.amount);
        const balance = b.status === "Cancelled" ? 0 : round2(amount - settled);
        if (query.pendingOnly && balance <= 0)
            continue;
        out.push({
            ...b,
            amount,
            settledAmount: settled,
            balance,
            settlements: ss,
            billAgeDays: Math.max(0, daysBetween(b.billDate, asOn)),
            overdueDays: Math.max(0, daysBetween(b.dueDate, asOn)),
            partyName: party?.partyName ?? null,
            partyCode: party?.partyCode ?? null,
            partyGroup: party?.partyGroup ?? null,
            settlementStatus: balance <= 0 ? "Settled" : settled > 0 ? "Partial" : "Unpaid",
        });
    }
    return out;
}
export async function listBills(query) {
    const bills = await loadBills({
        moduleType: query.moduleType,
        partyId: query.partyId,
        partyGroup: query.partyGroup,
        status: query.status,
        asOnDate: query.asOnDate,
        pendingOnly: query.pendingOnly === "true",
        billFrom: query.from,
        billTo: query.to,
    });
    const letters = await activeLetterByBill();
    return bills.map((b) => ({ ...b, coveringLetterNo: letters.get(b.id) ?? null }));
}
export async function getBill(id) {
    requireUuid(id);
    const bill = await mustGet(accTables.partyBills, id, "Bill");
    const [view] = await loadBills({ partyId: bill.partyId, status: "all", asOnDate: "9999-12-31" }).then((r) => r.filter((b) => b.id === id));
    return view ?? bill;
}
function validateBill(p) {
    if (p.moduleType && !["AR", "AP"].includes(p.moduleType))
        throw new ValidationError("moduleType must be AR or AP");
    if (p.amount !== undefined && num(p.amount) <= 0)
        throw new ValidationError("Bill amount must be greater than zero");
    if (p.billDate && p.dueDate && p.dueDate < p.billDate)
        throw new ValidationError("Due date cannot be before the bill date");
}
export async function createBill(body) {
    const p = cleanPayload(body, BILL_COLUMNS);
    if (!isUuid(p.partyId))
        throw new ValidationError("Select a party");
    if (!p.billNo)
        throw new ValidationError("Bill number is required");
    if (!isIsoDate(p.billDate))
        throw new ValidationError("Bill date is required");
    if (!p.moduleType)
        throw new ValidationError("moduleType (AR / AP) is required");
    if (!isIsoDate(p.dueDate)) {
        const party = await mustGet(accTables.parties, p.partyId, "Party");
        p.dueDate = addDays(p.billDate, num(party.creditDays));
    }
    validateBill(p);
    const row = await insert(accTables.partyBills, { ...p, createdBy: await actorName() });
    await audit("party_bill", row.id, "Created", { details: { billNo: row.billNo, amount: row.amount } });
    return getBill(row.id);
}
export async function updateBill(id, body) {
    requireUuid(id);
    const existing = await mustGet(accTables.partyBills, id, "Bill");
    const settled = await list(accTables.billSettlements, { eq: { bill_id: id }, select: "id" });
    const p = cleanPayload(body, BILL_COLUMNS);
    if (settled.length && (p.amount !== undefined || p.partyId !== undefined || p.moduleType !== undefined)) {
        throw new ConflictError("Amount, party and type cannot change once the bill has settlements");
    }
    validateBill({ ...existing, ...p });
    await update(accTables.partyBills, id, p);
    return getBill(id);
}
export async function cancelBill(id, reason) {
    requireUuid(id);
    if (!reason?.trim())
        throw new ValidationError("A reason is required");
    const settled = await list(accTables.billSettlements, { eq: { bill_id: id }, select: "id" });
    if (settled.length)
        throw new ConflictError("Bill has settlements — remove them first");
    await update(accTables.partyBills, id, { status: "Cancelled", remarks: reason.trim() });
    await audit("party_bill", id, "Cancelled", { reason: reason.trim() });
    return getBill(id);
}
export async function settleBill(billId, body) {
    requireUuid(billId);
    const bill = await getBill(billId);
    if (bill.status === "Cancelled")
        throw new ConflictError("Bill is cancelled");
    const amount = round2(num(body.amount));
    const deductions = round2(num(body.deductions));
    if (amount <= 0)
        throw new ValidationError("Settlement amount must be greater than zero");
    if (amount + deductions > num(bill.balance) + 0.005) {
        throw new ValidationError(`Settlement exceeds the pending balance (${num(bill.balance).toFixed(2)})`);
    }
    const date = isIsoDate(body.settlementDate) ? body.settlementDate : todayIso();
    if (date < bill.billDate)
        throw new ValidationError("Settlement date cannot be before the bill date");
    if (body.voucherId) {
        requireUuid(body.voucherId, "voucherId");
        const v = await mustGet(accTables.vouchers, body.voucherId, "Voucher");
        if (v.status !== "Posted")
            throw new ConflictError("Settlements must reference a posted voucher");
    }
    await insert(accTables.billSettlements, {
        billId,
        voucherId: body.voucherId ?? null,
        settlementDate: date,
        trnType: body.trnType || (bill.moduleType === "AR" ? "Receipts" : "Payments"),
        amount,
        deductions,
        referenceNo: body.referenceNo ?? "",
        remarks: body.remarks ?? "",
        createdBy: await actorName(),
    });
    await audit("party_bill", billId, "Settled", { details: { amount, deductions, voucherId: body.voucherId ?? null } });
    return getBill(billId);
}
export async function deleteSettlement(id) {
    requireUuid(id);
    const s = await mustGet(accTables.billSettlements, id, "Settlement");
    if (s.voucherId) {
        const v = await getById(accTables.vouchers, s.voucherId);
        if (v?.status === "Posted")
            throw new ConflictError(`Reverse voucher ${v.voucherNo} to remove this settlement`);
    }
    await remove(accTables.billSettlements, id);
    await audit("party_bill", s.billId, "Settlement removed", { details: { settlementId: id } });
    return { id };
}
// ---------------------------------------------------------------------------
// Voucher integration
// ---------------------------------------------------------------------------
export async function applyAllocations(voucher, allocations) {
    for (const a of allocations) {
        requireUuid(a.billId, "billId");
        const bill = await getBill(a.billId);
        const amount = round2(num(a.amount));
        if (amount <= 0)
            continue;
        if (amount + num(a.deductions) > num(bill.balance) + 0.005) {
            throw new ValidationError(`Allocation to ${bill.billNo} exceeds its pending balance (${num(bill.balance).toFixed(2)})`);
        }
        await insert(accTables.billSettlements, {
            billId: a.billId,
            voucherId: voucher.id,
            settlementDate: voucher.voucherDate,
            trnType: voucher.voucherCategory === "Receipt" ? "Receipts" :
                voucher.voucherCategory === "Payment" ? "Payments" :
                    voucher.voucherCategory === "Credit Note" ? "Credit Note" : "Journal",
            amount,
            deductions: round2(num(a.deductions)),
            referenceNo: voucher.instrumentNo || voucher.voucherNo,
            createdBy: await actorName(),
        });
    }
}
export async function createBillForVoucher(voucher, nb, total) {
    const partyId = nb.partyId ?? voucher.partyId;
    if (!isUuid(partyId))
        throw new ValidationError("A party is required to raise a bill");
    await createBill({
        partyId,
        moduleType: nb.moduleType,
        refType: nb.refType ?? (nb.moduleType === "AR" ? "Invoice" : "Bill"),
        billNo: nb.billNo || voucher.referenceNo || voucher.voucherNo,
        billDate: nb.billDate ?? voucher.voucherDate,
        dueDate: nb.dueDate,
        amount: nb.amount ?? total,
        details: nb.details ?? voucher.narration,
        voucherId: voucher.id,
        divisionId: nb.divisionId ?? voucher.divisionId ?? null,
    });
}
/** On voucher reversal: drop its settlements and cancel bills it raised (if unsettled elsewhere). */
export async function releaseVoucherBills(voucher) {
    const [settlements, bills] = await Promise.all([
        list(accTables.billSettlements, { eq: { voucher_id: voucher.id } }),
        list(accTables.partyBills, { eq: { voucher_id: voucher.id, status: "Open" } }),
    ]);
    for (const b of bills) {
        const others = await list(accTables.billSettlements, { eq: { bill_id: b.id } });
        const foreign = others.filter((s) => s.voucherId !== voucher.id);
        if (foreign.length) {
            throw new ConflictError(`Bill ${b.billNo} has settlements from other vouchers — reverse those first`);
        }
    }
    for (const s of settlements)
        await remove(accTables.billSettlements, s.id);
    for (const b of bills)
        await update(accTables.partyBills, b.id, { status: "Cancelled", remarks: `Voucher ${voucher.voucherNo} reversed` });
}
// ---------------------------------------------------------------------------
// Bill covering letters
// ---------------------------------------------------------------------------
async function activeLetterByBill() {
    const [letters, links] = await Promise.all([
        list(accTables.coveringLetters, { eq: { status: "Active" }, select: "id,letter_no" }),
        list(accTables.coveringLetterBills, { select: "letter_id,bill_id" }),
    ]);
    const noById = new Map(letters.map((l) => [l.id, l.letterNo]));
    const out = new Map();
    for (const l of links) {
        const no = noById.get(l.letterId);
        if (no)
            out.set(l.billId, no);
    }
    return out;
}
export async function coveringLetterCandidates(query) {
    const bills = await loadBills({
        moduleType: "AR",
        partyId: query.partyId,
        partyGroup: query.partyGroup,
        asOnDate: query.asOnDate,
        billFrom: query.from,
        billTo: query.to,
        status: "Open",
        pendingOnly: true,
    });
    const letters = await activeLetterByBill();
    return bills.filter((b) => !letters.has(b.id));
}
export async function listCoveringLetters(query) {
    const [letters, links, parties] = await Promise.all([
        list(accTables.coveringLetters, {
            eq: {
                status: typeof query.status === "string" && query.status !== "all" ? query.status : undefined,
                party_id: isUuid(query.partyId) ? query.partyId : undefined,
            },
            gte: { letter_date: isIsoDate(query.from) ? query.from : undefined },
            lte: { letter_date: isIsoDate(query.to) ? query.to : undefined },
            order: [{ column: "letter_date", ascending: false }, { column: "letter_no", ascending: false }],
        }),
        list(accTables.coveringLetterBills),
        list(accTables.parties),
    ]);
    const billIds = [...new Set(links.map((l) => l.billId))];
    const bills = billIds.length ? await list(accTables.partyBills, { in: { id: billIds } }) : [];
    const billById = new Map(bills.map((b) => [b.id, b]));
    const partyById = new Map(parties.map((p) => [p.id, p]));
    return letters.map((l) => {
        const party = partyById.get(l.partyId);
        return {
            ...l,
            totalAmount: num(l.totalAmount),
            partyName: party?.partyName ?? null,
            partyCode: party?.partyCode ?? null,
            partyGroup: party?.partyGroup ?? null,
            partyAddress: party
                ? [party.addressLine1, party.addressLine2, party.city, party.state, party.postalCode].filter(Boolean).join(", ")
                : "",
            partyGstin: party?.gstin ?? "",
            contactPersonName: party?.contactPersonName ?? "",
            bills: links
                .filter((x) => x.letterId === l.id)
                .map((x) => {
                const b = billById.get(x.billId);
                return {
                    id: x.id,
                    billId: x.billId,
                    billNo: b?.billNo ?? null,
                    billDate: b?.billDate ?? null,
                    dueDate: b?.dueDate ?? null,
                    details: b?.details ?? "",
                    amount: num(x.amount),
                };
            }),
        };
    });
}
export async function createCoveringLetter(body) {
    if (!Array.isArray(body.billIds) || body.billIds.length === 0)
        throw new ValidationError("Select at least one bill");
    body.billIds.forEach((id) => requireUuid(id, "billId"));
    const date = isIsoDate(body.letterDate) ? body.letterDate : todayIso();
    const bills = await list(accTables.partyBills, { in: { id: body.billIds } });
    if (bills.length !== body.billIds.length)
        throw new ValidationError("Some bills were not found");
    const partyIds = new Set(bills.map((b) => b.partyId));
    if (partyIds.size > 1)
        throw new ValidationError("All bills in a covering letter must belong to the same party");
    if (bills.some((b) => b.moduleType !== "AR" || b.status !== "Open")) {
        throw new ValidationError("Only open receivable bills can be sent with a covering letter");
    }
    const letters = await activeLetterByBill();
    const already = bills.filter((b) => letters.has(b.id));
    if (already.length) {
        throw new ConflictError(`${already.map((b) => b.billNo).join(", ")} already sent in ${letters.get(already[0].id)}`);
    }
    const fyCode = await fyCodeFor(date);
    const existing = await list(accTables.coveringLetters, { select: "letter_no" });
    const prefix = `BCL/${fyCode}/`;
    let max = 0;
    for (const e of existing) {
        const m = String(e.letterNo).match(new RegExp(`^${prefix.replace(/\//g, "\\/")}(\\d+)$`));
        if (m)
            max = Math.max(max, parseInt(m[1], 10));
    }
    const total = round2(bills.reduce((s, b) => s + num(b.amount), 0));
    const letter = await insert(accTables.coveringLetters, {
        letterNo: `${prefix}${String(max + 1).padStart(4, "0")}`,
        letterDate: date,
        partyId: bills[0].partyId,
        status: "Active",
        totalAmount: total,
        billsCount: bills.length,
        preparedBy: await actorName(),
        remarks: body.remarks ?? "",
    });
    await insertMany(accTables.coveringLetterBills, bills.map((b) => ({ letterId: letter.id, billId: b.id, amount: num(b.amount) })));
    await audit("covering_letter", letter.id, "Created", { details: { letterNo: letter.letterNo, bills: bills.length } });
    return (await listCoveringLetters({})).find((l) => l.id === letter.id);
}
export async function reverseCoveringLetter(id, reason) {
    requireUuid(id);
    if (!reason?.trim())
        throw new ValidationError("A reason is required to reverse a covering letter");
    const letter = await mustGet(accTables.coveringLetters, id, "Covering letter");
    if (letter.status !== "Active")
        throw new ConflictError("Covering letter is already reversed");
    await update(accTables.coveringLetters, id, {
        status: "Reversed",
        reversedAt: new Date().toISOString(),
        reversedBy: await actorName(),
        reversalReason: reason.trim(),
    });
    await audit("covering_letter", id, "Reversed", { reason: reason.trim() });
    return (await listCoveringLetters({})).find((l) => l.id === id);
}
async function fyCodeFor(date) {
    const fys = await list(accTables.fiscalYears, { lte: { start_date: date }, gte: { end_date: date }, limit: 1 });
    return fys[0]?.fyCode ?? date.slice(0, 4);
}
//# sourceMappingURL=bills.service.js.map
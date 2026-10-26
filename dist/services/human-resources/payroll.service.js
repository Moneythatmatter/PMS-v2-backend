import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { getActivePropertyId } from "../../utils/request-context.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newId } from "../../models/front-office/base.js";
export const PAYROLL_STATUS = {
    draft: "Draft",
    calculated: "Calculated",
    verified: "Verified",
    approved: "Approved",
    partiallyPaid: "Partially Paid",
    paid: "Paid",
};
/** Statuses after approval — the record is frozen until unlocked. */
const FROZEN_STATUSES = new Set([
    PAYROLL_STATUS.approved,
    PAYROLL_STATUS.partiallyPaid,
    PAYROLL_STATUS.paid,
    "Locked",
]);
const PAYABLE_STATUSES = new Set([PAYROLL_STATUS.approved, PAYROLL_STATUS.partiallyPaid]);
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const round2 = (n) => Math.round(n * 100) / 100;
function requireProperty() {
    const propertyId = getActivePropertyId();
    if (!propertyId)
        throw new AppError("X-Property-Id header is required", 400, "PROPERTY_REQUIRED");
    return propertyId;
}
function monthWindow(month, year) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(days).padStart(2, "0")}`, days };
}
function assertPeriod(month, year) {
    if (!Number.isInteger(month) || month < 1 || month > 12)
        throw new AppError("Pick a valid payroll month", 400);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
        throw new AppError("Pick a valid payroll year", 400);
}
async function selectAll(table, build) {
    const query = build(supabase.from(table));
    const { data, error } = await query;
    if (error)
        throw new AppError(error.message, 500);
    return toCamel(data ?? []);
}
export async function writePayrollAudit(entry) {
    await hrModel.create(hrTables.auditLogs, {
        id: newId(),
        module: "payroll",
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changedBy: entry.changedBy,
        auditNotes: entry.notes,
        overrideReason: entry.overrideReason,
    });
}
/* ---------------- calculation ---------------- */
const EARNING_KEYS = [
    [/basic/i, "basicSalary"],
    [/hra|house\s*rent/i, "hra"],
    [/over\s*time|\bot\b/i, "overtimePay"],
    [/holiday/i, "holidayPay"],
    [/incentive/i, "incentives"],
    [/bonus/i, "bonus"],
];
const DEDUCTION_KEYS = [
    [/\bpf\b|provident/i, "pfDeduction"],
    [/\besi|esic|state\s*insurance/i, "esiDeduction"],
    [/\bpt\b|professional/i, "ptDeduction"],
    [/tds|income\s*tax/i, "tdsDeduction"],
    [/leave|\blop\b|loss\s*of\s*pay/i, "leaveDeduction"],
];
function bucket(lines, keys, fallback) {
    const out = {};
    for (const line of lines ?? []) {
        const amount = Number(line.computedAmount ?? 0);
        if (!amount)
            continue;
        const key = keys.find(([re]) => re.test(line.componentName ?? ""))?.[1] ?? fallback;
        out[key] = round2((out[key] ?? 0) + amount);
    }
    return out;
}
const EMPTY_EARNINGS = {
    basicSalary: 0, hra: 0, allowances: 0, overtimePay: 0, holidayPay: 0, incentives: 0, bonus: 0, otherEarnings: 0,
};
const EMPTY_DEDUCTIONS = {
    leaveDeduction: 0, pfDeduction: 0, esiDeduction: 0, ptDeduction: 0, tdsDeduction: 0, otherDeductions: 0,
};
export function totalsFromBreakdown(earnings, deductions) {
    const earningsTotal = round2(Object.values(earnings).reduce((s, v) => s + (Number(v) || 0), 0));
    const deductionsTotal = round2(Object.values(deductions).reduce((s, v) => s + (Number(v) || 0), 0));
    return {
        grossSalary: earningsTotal,
        earningsTotal,
        deductionsTotal,
        netSalary: round2(Math.max(0, earningsTotal - deductionsTotal)),
    };
}
function resolveStructure(emp, structures) {
    const active = structures.filter((s) => (s.status ?? "Active") === "Active");
    return ((emp.salaryStructureId ? active.find((s) => s.id === emp.salaryStructureId) : undefined) ??
        active.find((s) => (s.assignedEmployeeIds ?? []).includes(emp.id)));
}
export async function calculatePayroll(input) {
    const { month, year } = input;
    assertPeriod(month, year);
    const propertyId = requireProperty();
    const { from, to } = monthWindow(month, year);
    const batchId = `PAY-${year}-${String(month).padStart(2, "0")}`;
    const [employees, structures, existing, attendance, leaves, overtime] = await Promise.all([
        selectAll(hrTables.employees, (q) => q.select("*").eq("property_id", propertyId).eq("status", "Active")),
        selectAll(hrTables.salaryStructures, (q) => q.select("*").eq("property_id", propertyId)),
        selectAll(hrTables.payrollRecords, (q) => q.select("*").eq("property_id", propertyId).eq("payroll_month", month).eq("payroll_year", year)),
        selectAll(hrTables.attendanceRecords, (q) => q.select("employee_id").eq("property_id", propertyId).eq("attendance_status", "PENDING")
            .gte("attendance_date", from).lte("attendance_date", to)),
        selectAll(hrTables.leaveApplications, (q) => q.select("employee_id").eq("property_id", propertyId).eq("status", "Pending")
            .lte("from_date", to).gte("to_date", from)),
        selectAll(hrTables.overtimeRecords, (q) => q.select("employee_id").eq("property_id", propertyId).eq("status", "Pending")
            .gte("record_date", from).lte("record_date", to)),
    ]);
    const wanted = input.employeeIds?.length ? new Set(input.employeeIds) : null;
    const targets = employees.filter((e) => !wanted || wanted.has(e.id));
    if (targets.length === 0) {
        throw new AppError(wanted ? "None of the selected employees are active" : "No active employees found. Add employees first.", 400);
    }
    const pendingAttendance = new Set(attendance.map((r) => r.employeeId));
    const pendingLeave = new Set(leaves.map((r) => r.employeeId));
    const pendingOt = new Set(overtime.map((r) => r.employeeId));
    const existingByEmployee = new Map(existing.map((r) => [r.employeeId, r]));
    const result = { calculated: 0, draft: 0, skipped: [] };
    const now = new Date().toISOString();
    for (const emp of targets) {
        const current = existingByEmployee.get(emp.id);
        if (current && (current.isLocked || FROZEN_STATUSES.has(current.status))) {
            result.skipped.push({
                employeeId: emp.id,
                reason: `${emp.firstName} ${emp.lastName} is ${current.status.toLowerCase()} and locked`,
            });
            continue;
        }
        const structure = resolveStructure(emp, structures);
        const validationFlags = {
            missingSalaryStructure: !structure,
            missingBankDetails: !emp.bankAccount || !emp.ifscCode,
            missingPan: !emp.panNumber,
            hasAttendanceIssue: pendingAttendance.has(emp.id),
            pendingLeaveApproval: pendingLeave.has(emp.id),
            pendingOtApproval: pendingOt.has(emp.id),
        };
        let earningsBreakdown = { ...EMPTY_EARNINGS };
        let deductionsBreakdown = { ...EMPTY_DEDUCTIONS };
        if (structure) {
            earningsBreakdown = { ...EMPTY_EARNINGS, ...bucket(structure.earnings, EARNING_KEYS, "allowances") };
            deductionsBreakdown = { ...EMPTY_DEDUCTIONS, ...bucket(structure.deductions, DEDUCTION_KEYS, "otherDeductions") };
            const lineGross = Object.values(earningsBreakdown).reduce((s, v) => s + v, 0);
            if (!lineGross && Number(structure.grossSalary)) {
                earningsBreakdown.basicSalary = round2(Number(structure.grossSalary));
            }
            const lineDeductions = Object.values(deductionsBreakdown).reduce((s, v) => s + v, 0);
            if (!lineDeductions && Number(structure.totalDeductions)) {
                deductionsBreakdown.otherDeductions = round2(Number(structure.totalDeductions));
            }
        }
        const totals = totalsFromBreakdown(earningsBreakdown, deductionsBreakdown);
        const status = structure ? PAYROLL_STATUS.calculated : PAYROLL_STATUS.draft;
        const payload = {
            payrollBatchId: batchId,
            ...totals,
            status,
            isLocked: false,
            calculatedAt: structure ? now : null,
            verifiedAt: null,
            approvedAt: null,
            earningsBreakdown,
            deductionsBreakdown,
            validationFlags,
            payslipGenerated: false,
            updatedAt: now,
        };
        if (current) {
            await hrModel.update(hrTables.payrollRecords, current.id, payload);
        }
        else {
            await hrModel.create(hrTables.payrollRecords, {
                id: newId(),
                employeeId: emp.id,
                payrollMonth: month,
                payrollYear: year,
                ...payload,
            });
        }
        if (structure)
            result.calculated += 1;
        else
            result.draft += 1;
    }
    await writePayrollAudit({
        action: `Calculated payroll ${batchId}: ${result.calculated} calculated, ${result.draft} draft, ${result.skipped.length} skipped (locked)`,
        entityType: "payroll_batch",
        entityId: batchId,
        changedBy: input.actor,
    });
    return { batchId, ...result, total: targets.length };
}
/* ---------------- record guards & edits ---------------- */
export async function getRecordOrThrow(id) {
    const row = await hrModel.get(hrTables.payrollRecords, id);
    if (!row)
        throw new NotFoundError("Payroll record not found");
    return row;
}
export function assertEditable(row) {
    if (row.isLocked || FROZEN_STATUSES.has(row.status)) {
        throw new ConflictError(`Payroll is ${row.status.toLowerCase()} and locked. Unlock it before making changes.`);
    }
}
export async function updatePayrollAmounts(id, input, actor) {
    const row = await getRecordOrThrow(id);
    assertEditable(row);
    const earningsBreakdown = { ...EMPTY_EARNINGS, ...(row.earningsBreakdown ?? {}) };
    const deductionsBreakdown = { ...EMPTY_DEDUCTIONS, ...(row.deductionsBreakdown ?? {}) };
    for (const key of Object.keys(EMPTY_EARNINGS)) {
        if (input.earnings[key] !== undefined)
            earningsBreakdown[key] = round2(Number(input.earnings[key]) || 0);
    }
    for (const key of Object.keys(EMPTY_DEDUCTIONS)) {
        if (input.deductions[key] !== undefined)
            deductionsBreakdown[key] = round2(Number(input.deductions[key]) || 0);
    }
    const values = [...Object.values(earningsBreakdown), ...Object.values(deductionsBreakdown)];
    if (values.some((v) => v < 0))
        throw new AppError("Amounts cannot be negative", 400);
    const totals = totalsFromBreakdown(earningsBreakdown, deductionsBreakdown);
    const now = new Date().toISOString();
    const updated = await hrModel.update(hrTables.payrollRecords, id, {
        earningsBreakdown,
        deductionsBreakdown,
        ...totals,
        // Any change to the numbers needs a fresh verification.
        status: totals.earningsTotal > 0 ? PAYROLL_STATUS.calculated : row.status,
        calculatedAt: totals.earningsTotal > 0 ? row.calculatedAt ?? now : row.calculatedAt,
        verifiedAt: null,
        updatedAt: now,
    });
    await writePayrollAudit({
        action: `Adjusted payroll ${id}: net ₹${row.netSalary} → ₹${totals.netSalary}`,
        entityType: "payroll_record",
        entityId: id,
        changedBy: actor,
        overrideReason: input.reason,
    });
    return updated;
}
/* ---------------- verify / approve ---------------- */
async function verifyOne(row, actor) {
    if (row.isLocked || FROZEN_STATUSES.has(row.status)) {
        throw new ConflictError("Payroll is already approved or paid");
    }
    if (row.status !== PAYROLL_STATUS.calculated) {
        throw new AppError(row.status === PAYROLL_STATUS.verified
            ? "Payroll is already verified"
            : "Only calculated payroll can be verified — fix the draft and recalculate first", 400);
    }
    const now = new Date().toISOString();
    await hrModel.update(hrTables.payrollRecords, row.id, {
        status: PAYROLL_STATUS.verified,
        verifiedAt: now,
        updatedAt: now,
    });
    await writePayrollAudit({
        action: `Verified payroll record ${row.id}`,
        entityType: "payroll_record",
        entityId: row.id,
        changedBy: actor,
    });
}
async function approveOne(row, actor) {
    if (row.isLocked || FROZEN_STATUSES.has(row.status)) {
        throw new ConflictError("Payroll is already approved or paid");
    }
    if (row.status !== PAYROLL_STATUS.calculated && row.status !== PAYROLL_STATUS.verified) {
        throw new AppError("Only calculated or verified payroll can be approved", 400);
    }
    if (!(Number(row.netSalary) > 0))
        throw new AppError("Net salary must be greater than 0 to approve", 400);
    const now = new Date().toISOString();
    await hrModel.update(hrTables.payrollRecords, row.id, {
        status: PAYROLL_STATUS.approved,
        approvedAt: now,
        isLocked: true,
        updatedAt: now,
    });
    await generatePayslipForPayroll(row.id);
    // Payments may survive an earlier unlock — keep status in line with them.
    await syncPayrollPaymentStatus(row.id);
    await writePayrollAudit({
        action: `Approved and locked payroll record ${row.id}; payslip generated`,
        entityType: "payroll_record",
        entityId: row.id,
        changedBy: actor,
    });
}
export async function verifyRecord(id, actor) {
    await verifyOne(await getRecordOrThrow(id), actor);
    return getRecordOrThrow(id);
}
export async function approveRecord(id, actor) {
    await approveOne(await getRecordOrThrow(id), actor);
    return getRecordOrThrow(id);
}
async function batchTargets(input, statuses) {
    const propertyId = requireProperty();
    if (input.ids?.length) {
        return selectAll(hrTables.payrollRecords, (q) => q.select("*").eq("property_id", propertyId).in("id", input.ids));
    }
    if (!input.month || !input.year)
        throw new AppError("Pass record ids or a payroll month and year", 400);
    return selectAll(hrTables.payrollRecords, (q) => q.select("*").eq("property_id", propertyId).eq("payroll_month", input.month)
        .eq("payroll_year", input.year).in("status", statuses));
}
async function runBatch(rows, fn) {
    const result = { updated: 0, skipped: [] };
    for (const row of rows) {
        try {
            await fn(row);
            result.updated += 1;
        }
        catch (e) {
            result.skipped.push({ id: row.id, reason: e instanceof Error ? e.message : "Failed" });
        }
    }
    return result;
}
export async function verifyBatch(input, actor) {
    const rows = await batchTargets(input, [PAYROLL_STATUS.calculated]);
    return runBatch(rows, (row) => verifyOne(row, actor));
}
export async function approveBatch(input, actor) {
    const rows = await batchTargets(input, [PAYROLL_STATUS.calculated, PAYROLL_STATUS.verified]);
    return runBatch(rows, (row) => approveOne(row, actor));
}
/* ---------------- unlock ---------------- */
export async function unlockRecord(id, reason, actor) {
    const row = await getRecordOrThrow(id);
    if (!reason.trim())
        throw new AppError("Give a reason for unlocking", 400);
    if (!row.isLocked && !FROZEN_STATUSES.has(row.status)) {
        throw new AppError("Payroll is not locked", 400);
    }
    const payslips = await selectAll(hrTables.payslips, (q) => q.select("id, payroll_id, status, payslip_no").eq("payroll_id", id));
    if (payslips.some((p) => p.status === "Sent")) {
        throw new ConflictError("The payslip has already been sent to the employee — this payroll can't be unlocked");
    }
    const { error } = await supabase.from(hrTables.payslips).delete().eq("payroll_id", id);
    if (error)
        throw new AppError(error.message, 500);
    const now = new Date().toISOString();
    await hrModel.update(hrTables.payrollRecords, id, {
        status: PAYROLL_STATUS.calculated,
        isLocked: false,
        approvedAt: null,
        verifiedAt: null,
        payslipGenerated: false,
        updatedAt: now,
    });
    await writePayrollAudit({
        action: `Unlocked payroll record ${id} (was ${row.status})`,
        entityType: "payroll_record",
        entityId: id,
        changedBy: actor,
        overrideReason: reason.trim(),
    });
    return getRecordOrThrow(id);
}
/* ---------------- payslips ---------------- */
export async function generatePayslipForPayroll(payrollId) {
    const row = await getRecordOrThrow(payrollId);
    const emp = await hrModel.get(hrTables.employees, row.employeeId);
    const { from, to } = monthWindow(row.payrollMonth, row.payrollYear);
    const attendance = await selectAll(hrTables.attendanceRecords, (q) => q.select("attendance_status").eq("employee_id", row.employeeId)
        .gte("attendance_date", from).lte("attendance_date", to));
    const count = (status) => attendance.filter((a) => a.attendanceStatus === status).length;
    const mm = String(row.payrollMonth).padStart(2, "0");
    const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const deductions = row.deductionsBreakdown ?? {};
    const payload = {
        payrollId,
        employeeId: row.employeeId,
        payslipNo: `PS-${row.payrollYear}-${mm}-${emp?.empCode || row.employeeId.slice(0, 8)}`,
        monthLabel: `${MONTHS[row.payrollMonth - 1]} ${row.payrollYear}`,
        payPeriod: `${fmt(from)} – ${fmt(to)}`,
        generatedDate: new Date().toISOString().slice(0, 10),
        paymentMode: "Bank Transfer",
        workedDays: count("PRESENT"),
        paidLeaves: count("LEAVE"),
        unpaidLeaves: count("ABSENT"),
        earnings: row.earningsBreakdown ?? {},
        deductions: { ...deductions, taxDeduction: deductions.tdsDeduction ?? 0 },
        grossSalary: row.grossSalary,
        totalDeductions: row.deductionsTotal,
        netSalary: row.netSalary,
        status: "Generated",
        sentDate: null,
        updatedAt: new Date().toISOString(),
    };
    const existing = await selectAll(hrTables.payslips, (q) => q.select("id, payroll_id, status, payslip_no").eq("payroll_id", payrollId));
    const payslip = existing[0]
        ? await hrModel.update(hrTables.payslips, existing[0].id, payload)
        : await hrModel.create(hrTables.payslips, { id: newId(), ...payload });
    await hrModel.update(hrTables.payrollRecords, payrollId, { payslipGenerated: true });
    return payslip;
}
async function sendOne(payslip, actor) {
    if (payslip.status === "Sent")
        throw new AppError("Payslip already sent", 400);
    if (!payslip.payrollId)
        throw new AppError("Payslip is not linked to a payroll record", 400);
    const payroll = await getRecordOrThrow(payslip.payrollId);
    if (!payroll.isLocked)
        throw new AppError("Approve the payroll before sending its payslip", 400);
    await hrModel.update(hrTables.payslips, payslip.id, {
        status: "Sent",
        sentDate: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString(),
    });
    await writePayrollAudit({
        action: `Sent payslip ${payslip.payslipNo} to employee`,
        entityType: "payslip",
        entityId: payslip.id,
        changedBy: actor,
    });
}
export async function sendPayslip(id, actor) {
    const payslip = await hrModel.get(hrTables.payslips, id);
    if (!payslip)
        throw new NotFoundError("Payslip not found");
    await sendOne(payslip, actor);
    return hrModel.get(hrTables.payslips, id);
}
export async function sendPayslipsBatch(input, actor) {
    const propertyId = requireProperty();
    let payslips;
    if (input.ids?.length) {
        payslips = await selectAll(hrTables.payslips, (q) => q.select("id, payroll_id, status, payslip_no").eq("property_id", propertyId).in("id", input.ids));
    }
    else {
        let payrollIds = input.payrollIds ?? [];
        if (!payrollIds.length) {
            if (!input.month || !input.year)
                throw new AppError("Pass payslip ids or a payroll month and year", 400);
            const records = await selectAll(hrTables.payrollRecords, (q) => q.select("id").eq("property_id", propertyId).eq("payroll_month", input.month).eq("payroll_year", input.year));
            payrollIds = records.map((r) => r.id);
        }
        payslips = payrollIds.length
            ? await selectAll(hrTables.payslips, (q) => q.select("id, payroll_id, status, payslip_no").eq("property_id", propertyId)
                .in("payroll_id", payrollIds).eq("status", "Generated"))
            : [];
    }
    const result = { sent: 0, skipped: [] };
    for (const p of payslips) {
        try {
            await sendOne(p, actor);
            result.sent += 1;
        }
        catch (e) {
            result.skipped.push({ id: p.id, reason: e instanceof Error ? e.message : "Failed" });
        }
    }
    return result;
}
/* ---------------- payments ---------------- */
export async function paidAmountFor(payrollIds) {
    if (!payrollIds.length)
        return new Map();
    const payments = await selectAll(hrTables.salaryPayments, (q) => q.select("id, payroll_id, amount, status").in("payroll_id", payrollIds).eq("status", "Completed"));
    const map = new Map();
    for (const p of payments)
        map.set(p.payrollId, round2((map.get(p.payrollId) ?? 0) + Number(p.amount)));
    return map;
}
export async function syncPayrollPaymentStatus(payrollId) {
    const row = await getRecordOrThrow(payrollId);
    if (!row.isLocked)
        return row;
    const paid = (await paidAmountFor([payrollId])).get(payrollId) ?? 0;
    const status = paid <= 0
        ? PAYROLL_STATUS.approved
        : paid + 0.005 < Number(row.netSalary)
            ? PAYROLL_STATUS.partiallyPaid
            : PAYROLL_STATUS.paid;
    if (status !== row.status) {
        await hrModel.update(hrTables.payrollRecords, payrollId, { status, updatedAt: new Date().toISOString() });
    }
    return { ...row, status };
}
export async function recordPayment(payrollId, body, actor) {
    const row = await getRecordOrThrow(payrollId);
    if (!PAYABLE_STATUSES.has(row.status)) {
        throw new AppError(row.status === PAYROLL_STATUS.paid
            ? "This payroll is already fully paid"
            : "Approve the payroll before recording a payment", 400);
    }
    const status = String(body.status ?? "Completed");
    if (!["Completed", "Pending", "Failed"].includes(status))
        throw new AppError("Invalid payment status", 400);
    const paid = (await paidAmountFor([payrollId])).get(payrollId) ?? 0;
    const outstanding = round2(Number(row.netSalary) - paid);
    const amount = round2(body.amount === undefined || body.amount === "" ? outstanding : Number(body.amount));
    if (!(amount > 0))
        throw new AppError("Payment amount must be greater than 0", 400);
    if (status === "Completed" && amount > outstanding + 0.005) {
        throw new AppError(`Amount is more than the outstanding balance of ₹${outstanding.toLocaleString("en-IN")}`, 400);
    }
    const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paymentDate ?? ""))
        ? String(body.paymentDate)
        : new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const payment = await hrModel.create(hrTables.salaryPayments, {
        id: newId(),
        payrollId,
        employeeId: row.employeeId,
        amount,
        paymentDate,
        paymentMode: String(body.paymentMode ?? "Bank Transfer"),
        transactionReference: String(body.transactionReference ?? "").trim(),
        status,
        remarks: String(body.remarks ?? "").trim(),
        recordedBy: actor,
        createdAt: now,
        updatedAt: now,
    });
    const synced = await syncPayrollPaymentStatus(payrollId);
    await writePayrollAudit({
        action: `Recorded ${status.toLowerCase()} salary payment of ₹${amount.toLocaleString("en-IN")} for payroll ${payrollId} (now ${synced.status})`,
        entityType: "salary_payment",
        entityId: payment.id,
        changedBy: actor,
        notes: body.remarks ? String(body.remarks) : undefined,
    });
    return { payment, payrollStatus: synced.status };
}
export async function listPayments(payrollId) {
    return selectAll(hrTables.salaryPayments, (q) => q.select("*").eq("payroll_id", payrollId).order("payment_date", { ascending: false }));
}
/** Payslip + payment summary per payroll record, for list screens. */
export async function payrollExtras(payrollIds) {
    if (!payrollIds.length)
        return new Map();
    const [payslips, paid] = await Promise.all([
        selectAll(hrTables.payslips, (q) => q.select("id, payroll_id, status, payslip_no").in("payroll_id", payrollIds)),
        paidAmountFor(payrollIds),
    ]);
    const slipBy = new Map(payslips.map((p) => [p.payrollId, p]));
    return new Map(payrollIds.map((id) => {
        const slip = slipBy.get(id);
        return [id, { payslipId: slip?.id, payslipNo: slip?.payslipNo, payslipStatus: slip?.status, paidAmount: paid.get(id) ?? 0 }];
    }));
}
//# sourceMappingURL=payroll.service.js.map
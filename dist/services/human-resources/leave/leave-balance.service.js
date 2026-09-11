import { hrModel, hrTables } from "../../../models/human-resources/index.js";
import { newId } from "../../../models/front-office/base.js";
const LEAVE_CODE_TO_BUCKET = {
    CL: "casual",
    "LV-CL": "casual",
    SL: "sick",
    "LV-SL": "sick",
    EL: "earned",
    "LV-EL": "earned",
};
export function leaveTypeCodeToBucket(code) {
    if (!code)
        return "casual";
    const normalized = code.toUpperCase().trim();
    if (LEAVE_CODE_TO_BUCKET[normalized])
        return LEAVE_CODE_TO_BUCKET[normalized];
    if (normalized.includes("SICK") || normalized.includes("SL"))
        return "sick";
    if (normalized.includes("EARNED") || normalized.includes("EL"))
        return "earned";
    if (normalized.includes("CASUAL") || normalized.includes("CL"))
        return "casual";
    return "casual";
}
async function getEmployeeBalance(employeeId) {
    const emp = await hrModel.get(hrTables.employees, employeeId);
    return {
        casual: emp?.leaveBalance?.casual ?? 0,
        sick: emp?.leaveBalance?.sick ?? 0,
        earned: emp?.leaveBalance?.earned ?? 0,
        ...emp?.leaveBalance,
    };
}
async function updateEmployeeBalance(employeeId, balance) {
    await hrModel.update(hrTables.employees, employeeId, {
        leaveBalance: balance,
        updatedAt: new Date().toISOString(),
    });
}
export async function hasConsumptionTransaction(leaveRequestId) {
    const rows = await hrModel.list(hrTables.leaveBalanceTransactions, {
        filters: { leave_request_id: leaveRequestId, transaction_type: "CONSUMED" },
        limit: 1,
    });
    return rows.length > 0;
}
export async function writeLeaveAudit(input) {
    await hrModel.create(hrTables.auditLogs, {
        id: newId(),
        propertyId: input.propertyId,
        module: "leave",
        action: input.action,
        entityType: "leave_application",
        entityId: input.leaveRequestId,
        changedBy: input.changedBy ?? "system",
        auditNotes: input.auditNotes,
    });
}
export async function applyConsumption(input) {
    if (await hasConsumptionTransaction(input.leaveRequestId)) {
        const existing = await hrModel.list(hrTables.leaveBalanceTransactions, { filters: { leave_request_id: input.leaveRequestId, transaction_type: "CONSUMED" }, limit: 1 });
        const balanceAfter = existing[0]?.balanceAfter ?? (await getEmployeeBalance(input.employeeId));
        return { transactionId: existing[0]?.id ?? "", balanceAfter };
    }
    const bucket = leaveTypeCodeToBucket(input.leaveTypeCode);
    const before = await getEmployeeBalance(input.employeeId);
    const current = before[bucket] ?? 0;
    const afterValue = Math.round((current - input.days) * 10) / 10;
    if (afterValue < 0) {
        throw new Error(`Insufficient ${bucket} leave balance. Required: ${input.days}, available: ${current}`);
    }
    const after = { ...before, [bucket]: afterValue };
    const txnId = newId();
    await hrModel.create(hrTables.leaveBalanceTransactions, {
        id: txnId,
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId ?? null,
        leaveRequestId: input.leaveRequestId,
        transactionType: "CONSUMED",
        days: -input.days,
        balanceBefore: before,
        balanceAfter: after,
        effectiveDates: input.effectiveDates,
        remarks: input.remarks ?? `Leave approved. ${input.days} day(s) consumed.`,
        createdBy: input.createdBy,
    });
    await updateEmployeeBalance(input.employeeId, after);
    return { transactionId: txnId, balanceAfter: after };
}
export async function applyRestoration(input) {
    if (input.days <= 0) {
        return { transactionId: "", balanceAfter: await getEmployeeBalance(input.employeeId) };
    }
    const bucket = leaveTypeCodeToBucket(input.leaveTypeCode);
    const before = await getEmployeeBalance(input.employeeId);
    const current = before[bucket] ?? 0;
    const after = {
        ...before,
        [bucket]: Math.round((current + input.days) * 10) / 10,
    };
    const txnId = newId();
    await hrModel.create(hrTables.leaveBalanceTransactions, {
        id: txnId,
        propertyId: input.propertyId,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId ?? null,
        leaveRequestId: input.leaveRequestId,
        transactionType: "RESTORED",
        days: input.days,
        balanceBefore: before,
        balanceAfter: after,
        effectiveDates: input.effectiveDates,
        remarks: input.remarks ?? `Leave restored. ${input.days} day(s) returned.`,
        createdBy: input.createdBy,
    });
    await updateEmployeeBalance(input.employeeId, after);
    return { transactionId: txnId, balanceAfter: after };
}
export async function applyDifferential(input) {
    const diff = input.oldEffectiveDays - input.newEffectiveDays;
    let balanceAfter = await getEmployeeBalance(input.employeeId);
    if (diff > 0) {
        const result = await applyRestoration({
            propertyId: input.propertyId,
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            leaveTypeCode: input.leaveTypeCode,
            leaveRequestId: input.leaveRequestId,
            effectiveDates: input.restoredDates,
            days: diff,
            createdBy: input.createdBy,
            remarks: input.remarks ?? `Leave modified. Restored ${diff} day(s).`,
        });
        balanceAfter = result.balanceAfter;
        return { restored: diff, consumed: 0, balanceAfter };
    }
    if (diff < 0) {
        const extra = Math.abs(diff);
        const result = await applyConsumption({
            propertyId: input.propertyId,
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            leaveTypeCode: input.leaveTypeCode,
            leaveRequestId: input.leaveRequestId,
            effectiveDates: input.consumedDates,
            days: extra,
            createdBy: input.createdBy,
            remarks: input.remarks ?? `Leave modified. Additional ${extra} day(s) consumed.`,
        });
        balanceAfter = result.balanceAfter;
        return { restored: 0, consumed: extra, balanceAfter };
    }
    return { restored: 0, consumed: 0, balanceAfter };
}
//# sourceMappingURL=leave-balance.service.js.map
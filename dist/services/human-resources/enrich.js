import { hrModel, hrTables } from "../../models/human-resources/index.js";
let deptCache = null;
let desigCache = null;
let empTypeCache = null;
let shiftCache = null;
async function loadLookups() {
    if (!deptCache) {
        const depts = await hrModel.list(hrTables.departments);
        deptCache = new Map(depts.map((d) => [d.id, d.departmentName]));
    }
    if (!desigCache) {
        const rows = await hrModel.list(hrTables.designations);
        desigCache = new Map(rows.map((d) => [d.id, d.designationTitle]));
    }
    if (!empTypeCache) {
        const rows = await hrModel.list(hrTables.employmentTypes);
        empTypeCache = new Map(rows.map((d) => [d.id, d.typeName]));
    }
    if (!shiftCache) {
        const rows = await hrModel.list(hrTables.shiftTypes);
        shiftCache = new Map(rows.map((d) => [d.id, d.shiftName]));
    }
}
export function clearHrLookupCache() {
    deptCache = null;
    desigCache = null;
    empTypeCache = null;
    shiftCache = null;
}
export async function enrichEmployee(emp) {
    await loadLookups();
    return {
        ...emp,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        department: emp.departmentId ? deptCache.get(emp.departmentId) ?? "" : "",
        designation: emp.designationId ? desigCache.get(emp.designationId) ?? "" : "",
        employmentType: emp.employmentTypeId ? empTypeCache.get(emp.employmentTypeId) ?? "" : "",
        shiftType: emp.shiftTypeId ? shiftCache.get(emp.shiftTypeId) ?? "" : "",
    };
}
export async function enrichEmployees(rows) {
    await loadLookups();
    return Promise.all(rows.map((e) => enrichEmployee(e)));
}
export async function enrichPayrollRecord(row) {
    const emp = await hrModel.get(hrTables.employees, row.employeeId);
    const enriched = emp ? await enrichEmployee(emp) : null;
    const earnings = row.earningsBreakdown ?? {};
    const deductions = row.deductionsBreakdown ?? {};
    return {
        ...row,
        payrollId: row.payrollBatchId ?? `PAY-${row.payrollYear}-${String(row.payrollMonth).padStart(2, "0")}`,
        employeeName: enriched?.name ?? "",
        department: enriched?.department ?? "",
        designation: enriched?.designation ?? "",
        avatar: enriched?.avatar ?? "",
        photoUrl: enriched?.photoUrl,
        basicSalary: earnings.basicSalary ?? 0,
        hra: earnings.hra ?? 0,
        allowances: earnings.allowances ?? 0,
        overtimePay: earnings.overtimePay ?? 0,
        holidayPay: earnings.holidayPay ?? 0,
        incentives: earnings.incentives ?? 0,
        bonus: earnings.bonus ?? 0,
        otherEarnings: earnings.otherEarnings ?? 0,
        leaveDeduction: deductions.leaveDeduction ?? 0,
        pfDeduction: deductions.pfDeduction ?? 0,
        esiDeduction: deductions.esiDeduction ?? 0,
        ptDeduction: deductions.ptDeduction ?? 0,
        tdsDeduction: deductions.tdsDeduction ?? 0,
        otherDeductions: deductions.otherDeductions ?? 0,
        hasAttendanceIssue: row.validationFlags?.hasAttendanceIssue,
        missingBankDetails: row.validationFlags?.missingBankDetails,
        missingSalaryStructure: row.validationFlags?.missingSalaryStructure,
        missingPan: row.validationFlags?.missingPan,
        pendingLeaveApproval: row.validationFlags?.pendingLeaveApproval,
        pendingOtApproval: row.validationFlags?.pendingOtApproval,
    };
}
export async function enrichPayrollRecords(rows) {
    return Promise.all(rows.map((r) => enrichPayrollRecord(r)));
}
export function splitEmployeePayload(body) {
    const earningsBreakdown = {
        basicSalary: body.basicSalary,
        hra: body.hra,
        allowances: body.allowances,
        overtimePay: body.overtimePay,
        holidayPay: body.holidayPay,
        incentives: body.incentives,
        bonus: body.bonus,
        otherEarnings: body.otherEarnings,
    };
    const deductionsBreakdown = {
        leaveDeduction: body.leaveDeduction,
        pfDeduction: body.pfDeduction,
        esiDeduction: body.esiDeduction,
        ptDeduction: body.ptDeduction,
        tdsDeduction: body.tdsDeduction,
        otherDeductions: body.otherDeductions,
    };
    const validationFlags = {
        hasAttendanceIssue: body.hasAttendanceIssue,
        missingBankDetails: body.missingBankDetails,
        missingSalaryStructure: body.missingSalaryStructure,
        missingPan: body.missingPan,
        pendingLeaveApproval: body.pendingLeaveApproval,
        pendingOtApproval: body.pendingOtApproval,
    };
    return { earningsBreakdown, deductionsBreakdown, validationFlags };
}
export function mapPayrollIncoming(body, isCreate) {
    const next = { ...body };
    const { earningsBreakdown, deductionsBreakdown, validationFlags } = splitEmployeePayload(body);
    if (Object.values(earningsBreakdown).some((v) => v !== undefined)) {
        next.earningsBreakdown = earningsBreakdown;
    }
    if (Object.values(deductionsBreakdown).some((v) => v !== undefined)) {
        next.deductionsBreakdown = deductionsBreakdown;
    }
    if (Object.values(validationFlags).some((v) => v !== undefined)) {
        next.validationFlags = validationFlags;
    }
    [
        "basicSalary", "hra", "allowances", "overtimePay", "holidayPay", "incentives", "bonus", "otherEarnings",
        "leaveDeduction", "pfDeduction", "esiDeduction", "ptDeduction", "tdsDeduction", "otherDeductions",
        "hasAttendanceIssue", "missingBankDetails", "missingSalaryStructure", "missingPan",
        "pendingLeaveApproval", "pendingOtApproval", "employeeName", "department", "designation", "avatar", "photoUrl", "payrollId",
    ].forEach((k) => delete next[k]);
    if (isCreate && !next.status)
        next.status = "Draft";
    return next;
}
//# sourceMappingURL=enrich.js.map
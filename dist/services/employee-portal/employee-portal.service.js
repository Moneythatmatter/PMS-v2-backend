import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { findDailyRecord } from "../human-resources/attendance/attendance.service.js";
import { enrichAttendanceRecords } from "../human-resources/attendance/enrich.js";
import { enrichEmployee } from "../human-resources/enrich.js";
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
function monthRange(ref = new Date()) {
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    return {
        fromDate: from.toISOString().slice(0, 10),
        toDate: to.toISOString().slice(0, 10),
    };
}
function activeShiftAssignment(rows, date) {
    const d = date.slice(0, 10);
    const active = rows.filter((r) => {
        if (r.status && r.status !== "Active")
            return false;
        const from = r.effectiveFrom.slice(0, 10);
        const to = r.effectiveTo?.slice(0, 10);
        if (d < from)
            return false;
        if (to && d > to)
            return false;
        return true;
    });
    active.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return active[0] ?? null;
}
export async function getEmployeeDashboard(input) {
    const { propertyId, employeeId } = input;
    const date = todayIso();
    const { fromDate, toDate } = monthRange();
    const [employeeRaw, todayRecord, monthRows, leaveRows, otRows, payslipRows, shiftRows,] = await Promise.all([
        hrModel.get(hrTables.employees, employeeId),
        findDailyRecord(propertyId, employeeId, date),
        hrModel.list(hrTables.attendanceRecords, {
            filters: { property_id: propertyId, employee_id: employeeId },
            orderBy: "attendance_date",
            ascending: false,
        }),
        hrModel.list(hrTables.leaveApplications, {
            filters: { property_id: propertyId, employee_id: employeeId },
            orderBy: "applied_on",
            ascending: false,
            limit: 50,
        }),
        hrModel.list(hrTables.overtimeRecords, {
            filters: { property_id: propertyId, employee_id: employeeId },
            orderBy: "record_date",
            ascending: false,
            limit: 20,
        }),
        hrModel.list(hrTables.payslips, {
            filters: { property_id: propertyId, employee_id: employeeId },
            orderBy: "generated_date",
            ascending: false,
            limit: 1,
        }),
        hrModel.list(hrTables.shiftAssignments, {
            filters: { property_id: propertyId, employee_id: employeeId },
            orderBy: "effective_from",
            ascending: false,
        }),
    ]);
    const employee = employeeRaw ? await enrichEmployee(employeeRaw) : null;
    const monthFiltered = monthRows.filter((r) => {
        const d = r.attendanceDate?.slice(0, 10) ?? "";
        return d >= fromDate && d <= toDate;
    });
    const presentCount = monthFiltered.filter((r) => ["Present", "Late", "Half Day"].includes(String(r.attendanceStatus ?? ""))).length;
    const leavePending = leaveRows.filter((r) => r.status === "Pending");
    const otPending = otRows.filter((r) => r.status === "Pending");
    const otApproved = otRows.filter((r) => r.status === "Approved");
    const todayShift = activeShiftAssignment(shiftRows, date);
    let todayAttendance = null;
    if (todayRecord) {
        const enriched = await enrichAttendanceRecords([todayRecord]);
        todayAttendance = enriched[0] ?? null;
    }
    return {
        date,
        employee: employee
            ? {
                id: employee.id,
                empCode: employee.empCode,
                name: employee.name,
                department: employee.department,
                designation: employee.designation,
                shiftType: employee.shiftType,
                leaveBalance: employee.leaveBalance,
            }
            : null,
        todayShift,
        todayAttendance,
        monthlySummary: {
            fromDate,
            toDate,
            totalDays: monthFiltered.length,
            presentDays: presentCount,
            records: monthFiltered.length,
        },
        leaveBalance: employee?.leaveBalance ?? { casual: 0, sick: 0, earned: 0 },
        pendingLeaveRequests: leavePending.slice(0, 5),
        pendingLeaveCount: leavePending.length,
        latestPayslip: payslipRows[0] ?? null,
        overtime: {
            pending: otPending.slice(0, 5),
            pendingCount: otPending.length,
            approvedCount: otApproved.length,
        },
    };
}
export function toEmployeeProfile(employee) {
    return {
        id: employee.id,
        empCode: employee.empCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        name: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
        email: employee.email,
        phone: employee.phone,
        gender: employee.gender,
        dob: employee.dob,
        address: employee.address,
        joinDate: employee.joinDate,
        status: employee.status,
        department: employee.department,
        designation: employee.designation,
        employmentType: employee.employmentType,
        shiftType: employee.shiftType,
        reportingManager: employee.reportingManager,
        emergencyContact: employee.emergencyContact,
        bloodGroup: employee.bloodGroup,
        bankAccount: employee.bankAccount,
        bankName: employee.bankName,
        ifscCode: employee.ifscCode,
        panNumber: employee.panNumber,
        uanNumber: employee.uanNumber,
        esicNumber: employee.esicNumber,
        leaveBalance: employee.leaveBalance,
        avatar: employee.avatar,
        photoUrl: employee.photoUrl,
    };
}
//# sourceMappingURL=employee-portal.service.js.map
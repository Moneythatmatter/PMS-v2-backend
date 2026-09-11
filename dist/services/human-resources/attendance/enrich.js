import { hrModel, hrTables } from "../../../models/human-resources/index.js";
export async function enrichAttendanceRecords(rows) {
    if (!rows.length)
        return rows;
    const [shifts, holidays, employees, depts, desigs, leaves] = await Promise.all([
        hrModel.list(hrTables.shiftTypes),
        hrModel.list(hrTables.holidays),
        hrModel.list(hrTables.employees),
        hrModel.list(hrTables.departments),
        hrModel.list(hrTables.designations),
        hrModel.list(hrTables.leaveApplications),
    ]);
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const holidayMap = new Map(holidays.map((h) => [h.id, h]));
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const deptMap = new Map(depts.map((d) => [d.id, d.departmentName]));
    const desigMap = new Map(desigs.map((d) => [d.id, d.designationTitle]));
    const leaveMap = new Map(leaves.map((l) => [l.id, l]));
    return rows.map((row) => {
        const shiftId = String(row.shiftId ?? "");
        const holidayId = String(row.holidayId ?? "");
        const employeeId = String(row.employeeId ?? "");
        const leaveRequestId = String(row.leaveRequestId ?? "");
        const shift = shiftMap.get(shiftId);
        const holiday = holidayMap.get(holidayId);
        const emp = empMap.get(employeeId);
        const leave = leaveMap.get(leaveRequestId);
        const employeeName = emp
            ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
            : String(row.employeeName ?? "");
        return {
            ...row,
            shiftCode: shift?.shiftCode ?? row.shiftCode,
            shiftName: shift?.shiftName ?? row.shiftName,
            holidayName: holiday?.holidayName ?? null,
            employeeName,
            empCode: emp?.empCode ?? row.empCode,
            avatar: emp?.avatar ?? row.avatar,
            department: emp?.departmentId ? deptMap.get(emp.departmentId) : row.department,
            designation: emp?.designationId ? desigMap.get(emp.designationId) : row.designation,
            leaveTypeName: leave?.leaveTypeName ?? null,
            leaveFromDate: leave?.fromDate ?? null,
            leaveToDate: leave?.toDate ?? null,
        };
    });
}
//# sourceMappingURL=enrich.js.map
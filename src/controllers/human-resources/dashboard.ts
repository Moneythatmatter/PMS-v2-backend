import type { Request, Response } from "express";
import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { fromError, ok } from "../../utils/response.js";

export async function getDashboard(_req: Request, res: Response) {
  try {
    const employees = await hrModel.list<{ status: string }>(hrTables.employees);
    const leaveApps = await hrModel.list<{ status: string }>(hrTables.leaveApplications);
    const payroll = await hrModel.list<{ status: string; netSalary: number; grossSalary: number; deductionsTotal: number }>(
      hrTables.payrollRecords,
    );
    const complaints = await hrModel.list<{ status: string }>(hrTables.complaints);
    const depts = await hrModel.list<{ id: string; departmentName: string }>(hrTables.departments);

    const totalEmployees = employees.length;
    const activeEmployees = employees.filter((e) => e.status === "Active").length;
    const pendingLeaves = leaveApps.filter((l) => l.status === "Pending").length;
    const processedPayroll = payroll.filter((p) => p.status !== "Draft").length;
    const pendingPayroll = payroll.filter((p) => p.status === "Draft" || p.status === "Calculated").length;
    const grossPayroll = payroll.reduce((s, p) => s + Number(p.grossSalary ?? 0), 0);
    const totalDeductions = payroll.reduce((s, p) => s + Number(p.deductionsTotal ?? 0), 0);

    const deptCounts = await Promise.all(
      depts.map(async (d) => {
        const emps = await hrModel.list<{ departmentId: string }>(hrTables.employees, {
          filters: { department_id: d.id },
        });
        return { department: d.departmentName, count: emps.length };
      }),
    );

    return ok(res, {
      kpi: {
        totalEmployees,
        activeEmployees,
        newJoineesThisMonth: 1,
        presentCount: Math.round(activeEmployees * 0.92),
        attendanceRate: 94.2,
        onLeaveCount: pendingLeaves,
        pendingLeaveRequestsCount: pendingLeaves,
        payrollProcessedCount: processedPayroll,
        payrollPendingCount: pendingPayroll,
        payCycleDate: "10 Aug 2026",
      },
      departmentHeadcounts: deptCounts,
      grievances: {
        open: complaints.filter((c) => c.status === "Submitted" || c.status === "Open").length,
        inProgress: complaints.filter((c) => c.status === "In Progress").length,
        escalated: complaints.filter((c) => c.status === "Escalated").length,
        resolved: complaints.filter((c) => c.status === "Resolved" || c.status === "Closed").length,
      },
      payrollSummary: {
        grossPayroll,
        totalDeductions,
        netPayroll: grossPayroll - totalDeductions,
      },
    });
  } catch (e) {
    return fromError(res, e);
  }
}

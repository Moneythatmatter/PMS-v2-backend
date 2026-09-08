import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireProperty } from "../middleware/property.js";
import { attachRequestContext } from "../middleware/request-context.js";
import { createTableCrud, mountCrud } from "../controllers/shared-crud.js";
import { hrTables } from "../models/human-resources/index.js";
import { getDashboard } from "../controllers/human-resources/dashboard.js";
import * as employees from "../controllers/human-resources/employees.js";
import * as payroll from "../controllers/human-resources/payroll.js";
import * as attendance from "../controllers/human-resources/attendance.js";
import * as leaveApplications from "../controllers/human-resources/leave-applications.js";
import * as weeklyOffs from "../controllers/human-resources/weekly-offs.js";

const router = Router();

router.use(requireAuth);
router.use(requireProperty);
router.use(attachRequestContext);

router.get("/dashboard", getDashboard);

// Employees (enriched)
router.get("/employees", employees.listEmployees);
router.get("/employees/:id", employees.getEmployee);
router.post("/employees", employees.createEmployee);
router.put("/employees/:id", employees.updateEmployee);
router.patch("/employees/:id", employees.updateEmployee);
router.delete("/employees/:id", employees.deleteEmployee);

// Payroll ops
router.get("/payroll/audit-logs", payroll.listAuditLogs);
router.get("/payroll/records", payroll.listPayrollRecords);
router.get("/payroll/records/:id", payroll.getPayrollRecord);
router.post("/payroll/records", payroll.createPayrollRecord);
router.put("/payroll/records/:id", payroll.updatePayrollRecord);
router.patch("/payroll/records/:id", payroll.updatePayrollRecord);
router.post("/payroll/records/:id/approve", payroll.approvePayrollRecord);
router.post("/payroll/records/:id/payments", payroll.recordSalaryPayment);

// Attendance (server-side business logic)
router.get("/attendance/daily", attendance.getDailyAttendance);
router.get("/attendance/employee/:employeeId", attendance.getEmployeeAttendance);
router.get("/attendance", attendance.listAttendance);
router.get("/attendance/:id", attendance.getAttendance);
router.post("/attendance/punch-in", attendance.postPunchIn);
router.post("/attendance/punch-out", attendance.postPunchOut);
router.post("/attendance/process-absence", attendance.postProcessAbsence);
router.post("/attendance/:id/recalculate", attendance.postRecalculate);
router.post("/attendance/:id/correct", attendance.postCorrect);

// Leave applications (with attendance sync + balance on approval)
router.get("/leave-applications", leaveApplications.listLeaveApplications);
router.post("/leave-applications/preview-days", leaveApplications.previewLeaveApplicationDays);
router.post("/leave-applications", leaveApplications.createLeaveApplication);
router.get("/leave-applications/:id", leaveApplications.getLeaveApplication);
router.put("/leave-applications/:id", leaveApplications.updateLeaveApplication);
router.patch("/leave-applications/:id", leaveApplications.updateLeaveApplication);
router.delete("/leave-applications/:id", leaveApplications.deleteLeaveApplication);
router.post("/leave-applications/:id/approve", leaveApplications.approveLeaveApplication);
router.post("/leave-applications/:id/cancel", leaveApplications.cancelLeaveApplication);
router.post("/leave-applications/:id/modify", leaveApplications.modifyLeaveApplication);

// Weekly offs (validated CRUD + staffing preview — schedule only, no attendance rows)
router.get("/weekly-offs/staffing-preview", weeklyOffs.getStaffingPreview);
router.get("/weekly-offs", weeklyOffs.listWeeklyOffs);
router.post("/weekly-offs", weeklyOffs.createWeeklyOff);
router.get("/weekly-offs/:id", weeklyOffs.getWeeklyOff);
router.put("/weekly-offs/:id", weeklyOffs.updateWeeklyOff);
router.patch("/weekly-offs/:id", weeklyOffs.updateWeeklyOff);
router.delete("/weekly-offs/:id", weeklyOffs.deleteWeeklyOff);

// Masters & operational CRUD
const crudRoutes: { path: string; table: string; prefix: string; orderBy?: string }[] = [
  { path: "/masters/departments", table: hrTables.departments, prefix: "HRD", orderBy: "dept_code" },
  { path: "/masters/designations", table: hrTables.designations, prefix: "HRDS", orderBy: "designation_code" },
  { path: "/masters/employment-types", table: hrTables.employmentTypes, prefix: "HRET", orderBy: "type_code" },
  { path: "/masters/shift-types", table: hrTables.shiftTypes, prefix: "HRST", orderBy: "shift_code" },
  { path: "/masters/leave-types", table: hrTables.leaveTypes, prefix: "HRLT", orderBy: "leave_code" },
  { path: "/masters/leave-policies", table: hrTables.leavePolicies, prefix: "HRLP", orderBy: "policy_code" },
  { path: "/masters/holidays", table: hrTables.holidays, prefix: "HRH", orderBy: "holiday_date" },
  { path: "/masters/salary-components", table: hrTables.salaryComponents, prefix: "HRSC", orderBy: "code" },
  { path: "/masters/document-categories", table: hrTables.documentCategories, prefix: "HRDC", orderBy: "name" },
  { path: "/masters/document-types", table: hrTables.documentTypes, prefix: "HRDT", orderBy: "name" },
  { path: "/shift-assignments", table: hrTables.shiftAssignments, prefix: "HRSA", orderBy: "effective_from" },
  { path: "/overtime", table: hrTables.overtimeRecords, prefix: "HROT", orderBy: "record_date" },
  { path: "/holiday-attendance", table: hrTables.holidayAttendanceRecords, prefix: "HRHA", orderBy: "holiday_date" },
  { path: "/salary-structures", table: hrTables.salaryStructures, prefix: "HRSS", orderBy: "name" },
  { path: "/salary-payments", table: hrTables.salaryPayments, prefix: "HRSP", orderBy: "payment_date" },
  { path: "/payslips", table: hrTables.payslips, prefix: "HRPS", orderBy: "generated_date" },
  { path: "/complaint-categories", table: hrTables.complaintCategories, prefix: "HRCC", orderBy: "category_name" },
  { path: "/complaints", table: hrTables.complaints, prefix: "HRC", orderBy: "submitted_date" },
  { path: "/approval-workflows", table: hrTables.approvalWorkflows, prefix: "HRAW", orderBy: "code" },
  { path: "/tax/rules", table: hrTables.taxRules, prefix: "HRTX", orderBy: "tax_code" },
];

for (const cfg of crudRoutes) {
  mountCrud(
    router,
    cfg.path,
    createTableCrud({
      table: cfg.table,
      idPrefix: cfg.prefix,
      orderBy: cfg.orderBy,
    }),
  );
}

// Payroll settings (singleton per property)
const settingsCrud = createTableCrud({
  table: hrTables.payrollSettings,
  idPrefix: "HRSET",
});
router.get("/payroll/settings", settingsCrud.list);
router.get("/payroll/settings/:id", settingsCrud.get);
router.post("/payroll/settings", settingsCrud.create);
router.put("/payroll/settings/:id", settingsCrud.update);
router.patch("/payroll/settings/:id", settingsCrud.update);

export default router;

import { hrModel, hrTables } from "../../models/human-resources/index.js";
import { newCode, newId } from "../../models/front-office/base.js";
import { clearHrLookupCache, enrichEmployee, enrichEmployees } from "../../services/human-resources/enrich.js";
import { fail, fromError, ok } from "../../utils/response.js";
/** Postgres rejects "" for date/uuid FK columns — coerce blanks to null. */
const EMPLOYEE_NULLABLE_KEYS = [
    "departmentId",
    "designationId",
    "employmentTypeId",
    "shiftTypeId",
    "leavePolicyId",
    "salaryStructureId",
    "joinDate",
    "dob",
    "phone",
    "gender",
    "address",
    "bloodGroup",
    "emergencyContact",
    "reportingManager",
    "avatar",
    "photoUrl",
    "bankAccount",
    "bankName",
    "ifscCode",
    "panNumber",
    "uanNumber",
    "esicNumber",
];
function sanitizeEmployeePayload(body) {
    const out = { ...body };
    for (const key of EMPLOYEE_NULLABLE_KEYS) {
        if (out[key] === "" || out[key] === undefined)
            out[key] = null;
    }
    return out;
}
function applyNameSplit(body, force = false) {
    if (!body.name)
        return;
    if (!force && body.firstName)
        return;
    const parts = String(body.name).split(" ").filter(Boolean);
    body.firstName = parts[0] ?? body.firstName;
    body.lastName = parts.slice(1).join(" ") || parts[0] || body.lastName;
    delete body.name;
}
export async function listEmployees(_req, res) {
    try {
        const rows = await hrModel.list(hrTables.employees, { orderBy: "emp_code" });
        return ok(res, await enrichEmployees(rows));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getEmployee(req, res) {
    try {
        const row = await hrModel.get(hrTables.employees, String(req.params.id));
        if (!row)
            return fail(res, "Employee not found", 404);
        return ok(res, await enrichEmployee(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createEmployee(req, res) {
    try {
        let body = sanitizeEmployeePayload({ ...req.body });
        if (!body.id)
            body.id = newId();
        if (!body.empCode || String(body.empCode).trim() === "") {
            body.empCode = newCode("EMP");
        }
        applyNameSplit(body);
        clearHrLookupCache(req.propertyId);
        const row = await hrModel.create(hrTables.employees, body);
        return ok(res, await enrichEmployee(row), 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateEmployee(req, res) {
    try {
        let body = sanitizeEmployeePayload({ ...req.body });
        delete body.id;
        applyNameSplit(body, true);
        clearHrLookupCache(req.propertyId);
        const row = await hrModel.update(hrTables.employees, String(req.params.id), body);
        return ok(res, await enrichEmployee(row));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteEmployee(req, res) {
    try {
        await hrModel.remove(hrTables.employees, String(req.params.id));
        clearHrLookupCache(req.propertyId);
        return ok(res, { id: req.params.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=employees.js.map
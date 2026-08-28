import { DamageReportService } from "../../services/housekeeping/damage-report.service.js";
import { fromError, ok } from "../../utils/response.js";
export async function listDamageReports(req, res) {
    try {
        const rows = await DamageReportService.list({
            status: req.query.status,
            roomId: req.query.roomId,
            damageType: req.query.damageType,
            severity: req.query.severity,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getDamageReport(req, res) {
    try {
        return ok(res, await DamageReportService.get(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createDamageReport(req, res) {
    try {
        const row = await DamageReportService.create((req.body ?? {}));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateDamageReport(req, res) {
    try {
        const row = await DamageReportService.update(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function resolveDamageReport(req, res) {
    try {
        const row = await DamageReportService.resolve(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=damage-reports.js.map
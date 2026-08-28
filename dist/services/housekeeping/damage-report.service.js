import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import { enrichDamageReport, enrichDamageReports, parseCost, parseReportedAt, persistDamageReportRow, resolveDamageReportId, resolveGuestIdByName, resolveReporterUserId, resolveReporterUserLabel, resolveRoomIdForDamageReport, sanitizeDamageReportInput, } from "./damage-report-enrich.js";
import { normalizeDamageReportStatus, normalizeDamageResponsibility, normalizeDamageSeverity, normalizeDamageType, } from "../../types/housekeeping.js";
const CLOSED_STATUSES = [
    "REPAIRED",
    "RECOVERED",
    "CLOSED",
    "CANCELLED",
];
async function getReportOrThrow(id) {
    const row = await hkModel.get(hkModel.tables.damageReports, id);
    if (!row)
        throw new NotFoundError("Damage report not found");
    return row;
}
async function appendHistory(entry) {
    await hkModel.create(hkModel.tables.history, {
        id: hkModel.newId("H"),
        timestamp: new Date().toISOString(),
        ...entry,
    });
}
export const DamageReportService = {
    async list(filters = {}) {
        const queryFilters = {};
        if (filters.status) {
            queryFilters.status = normalizeDamageReportStatus(filters.status);
        }
        if (filters.damageType) {
            queryFilters.damage_type = normalizeDamageType(filters.damageType);
        }
        if (filters.severity) {
            queryFilters.severity = normalizeDamageSeverity(filters.severity);
        }
        let rows = await hkModel.list(hkModel.tables.damageReports, {
            filters: queryFilters,
            orderBy: "reported_at",
            ascending: false,
        });
        if (filters.roomId) {
            const roomId = (await resolveRoomIdForDamageReport(filters.roomId)) ?? filters.roomId;
            rows = rows.filter((r) => String(r.roomId) === roomId);
        }
        return enrichDamageReports(rows);
    },
    async get(id) {
        const resolved = await resolveDamageReportId(id);
        if (!resolved)
            throw new NotFoundError("Damage report not found");
        return enrichDamageReport(await getReportOrThrow(resolved));
    },
    async create(input) {
        const guestRaw = String(input.guest ?? input.guestName ?? "").trim();
        const body = sanitizeDamageReportInput(input);
        const description = String(body.description ?? "").trim();
        if (!description)
            throw new AppError("description is required", 400);
        body.description = description;
        body.damageType = normalizeDamageType(body.damageType ?? "OTHER");
        body.severity = normalizeDamageSeverity(body.severity ?? "MODERATE");
        body.responsibility = normalizeDamageResponsibility(body.responsibility ?? "HOTEL");
        body.status = normalizeDamageReportStatus(body.status ?? "REPORTED");
        body.estimatedCost = parseCost(body.estimatedCost);
        if (body.roomId != null) {
            const roomKey = String(body.roomId).trim();
            body.roomId = roomKey
                ? (await resolveRoomIdForDamageReport(roomKey)) ?? roomKey
                : null;
        }
        if (guestRaw) {
            body.guestId = await resolveGuestIdByName(guestRaw);
        }
        const reporterRaw = String(body.reportedBy ?? input.reportedBy ?? "").trim();
        const reporterLabel = (await resolveReporterUserLabel(reporterRaw)) || reporterRaw;
        const resolvedReporter = reporterRaw
            ? await resolveReporterUserId(reporterRaw)
            : null;
        body.reportedAt = parseReportedAt(body.reportedAt);
        if (body.actualCost != null)
            body.actualCost = parseCost(body.actualCost);
        if (!body.id)
            body.id = hkModel.newId();
        delete body.guest;
        const saved = await persistDamageReportRow({
            ...body,
            reportedBy: resolvedReporter,
        }, { mode: "create" }, reporterLabel || undefined);
        const row = await enrichDamageReport({
            ...saved,
            reportedByName: reporterLabel || undefined,
        });
        await appendHistory({
            user: reporterLabel || "Housekeeping",
            category: "Room Status",
            action: "Damage Reported",
            room: row.roomNo ?? undefined,
            details: `${row.reportNumber ?? row.id}: ${description} — est. ₹${row.estimatedCost}`,
        });
        return row;
    },
    async update(id, input) {
        const resolved = await resolveDamageReportId(id);
        if (!resolved)
            throw new NotFoundError("Damage report not found");
        const existing = await getReportOrThrow(resolved);
        if (CLOSED_STATUSES.includes(existing.status)) {
            throw new ConflictError(`Cannot edit report in status ${existing.status}`);
        }
        const body = sanitizeDamageReportInput(input);
        const patch = {};
        if (body.description != null) {
            const description = String(body.description).trim();
            if (!description)
                throw new AppError("description is required", 400);
            patch.description = description;
        }
        if (body.damageType != null) {
            patch.damageType = normalizeDamageType(body.damageType);
        }
        if (body.severity != null) {
            patch.severity = normalizeDamageSeverity(body.severity);
        }
        if (body.responsibility != null) {
            patch.responsibility = normalizeDamageResponsibility(body.responsibility);
        }
        if (body.estimatedCost != null) {
            patch.estimatedCost = parseCost(body.estimatedCost);
        }
        if (body.actualCost != null)
            patch.actualCost = parseCost(body.actualCost);
        if (body.notes != null)
            patch.notes = body.notes;
        if (body.assetId != null)
            patch.assetId = body.assetId;
        if (body.status != null) {
            patch.status = normalizeDamageReportStatus(body.status);
        }
        if (body.roomId != null) {
            const roomKey = String(body.roomId).trim();
            patch.roomId = roomKey
                ? (await resolveRoomIdForDamageReport(roomKey)) ?? roomKey
                : null;
        }
        if (body.reportedBy != null) {
            const reporterRaw = String(body.reportedBy).trim();
            const reporterLabel = (await resolveReporterUserLabel(reporterRaw)) || reporterRaw;
            patch.reportedBy = reporterRaw
                ? await resolveReporterUserId(reporterRaw)
                : null;
            const saved = await persistDamageReportRow(patch, { mode: "update", id: resolved }, reporterLabel || undefined);
            return enrichDamageReport({
                ...saved,
                reportedByName: reporterLabel || undefined,
            });
        }
        const saved = await persistDamageReportRow(patch, {
            mode: "update",
            id: resolved,
        });
        return enrichDamageReport(saved);
    },
    async resolve(id, input = {}) {
        const resolved = await resolveDamageReportId(id);
        if (!resolved)
            throw new NotFoundError("Damage report not found");
        const existing = await getReportOrThrow(resolved);
        if (CLOSED_STATUSES.includes(existing.status)) {
            throw new ConflictError(`Report already ${existing.status.toLowerCase()}`);
        }
        const nowIso = new Date().toISOString();
        const actualCost = input.actualCost != null
            ? parseCost(input.actualCost)
            : existing.actualCost ?? existing.estimatedCost;
        const saved = await persistDamageReportRow({
            status: normalizeDamageReportStatus(input.status ?? "CLOSED"),
            actualCost,
            resolvedAt: nowIso,
            notes: input.notes ?? existing.notes,
        }, { mode: "update", id: resolved });
        const row = await enrichDamageReport(saved);
        await appendHistory({
            user: "Housekeeping",
            category: "Room Status",
            action: "Damage Resolved",
            room: row.roomNo ?? undefined,
            details: `${row.reportNumber ?? row.id} closed — actual ₹${row.actualCost ?? 0}`,
        });
        return row;
    },
};
//# sourceMappingURL=damage-report.service.js.map
import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import { enrichMaintenanceRequest, enrichMaintenanceRequests, parseEstimatedCompletionAt, persistMaintenanceRequestRow, resolveMaintenanceAssignee, resolveMaintenanceAssigneeLabel, resolveMaintenanceRequestId, resolvePublicAreaId, resolveRoomIdForMaintenance, sanitizeMaintenanceRequestInput, } from "./maintenance-request-enrich.js";
import { normalizeMaintenanceIssueType, normalizeMaintenanceRequestPriority, normalizeMaintenanceRequestStatus, } from "../../types/housekeeping.js";
const ACTIVE_STATUSES = [
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
];
async function getRequestOrThrow(id) {
    const row = await hkModel.get(hkModel.shared.maintenanceRequests, id);
    if (!row)
        throw new NotFoundError("Maintenance request not found");
    return row;
}
async function appendHistory(entry) {
    await hkModel.create(hkModel.tables.history, {
        id: hkModel.newId("H"),
        timestamp: new Date().toISOString(),
        ...entry,
    });
}
export const MaintenanceRequestService = {
    async list(filters = {}) {
        const queryFilters = {};
        if (filters.status) {
            queryFilters.status = normalizeMaintenanceRequestStatus(filters.status);
        }
        if (filters.issueType) {
            queryFilters.issue_type = normalizeMaintenanceIssueType(filters.issueType);
        }
        if (filters.priority) {
            queryFilters.priority = normalizeMaintenanceRequestPriority(filters.priority);
        }
        let rows = await hkModel.list(hkModel.shared.maintenanceRequests, {
            filters: queryFilters,
            orderBy: "reported_at",
            ascending: false,
        });
        if (filters.roomId) {
            const roomId = (await resolveRoomIdForMaintenance(filters.roomId)) ?? filters.roomId;
            rows = rows.filter((r) => String(r.roomId) === roomId);
        }
        if (filters.publicAreaId) {
            const areaId = (await resolvePublicAreaId(filters.publicAreaId)) ??
                filters.publicAreaId;
            rows = rows.filter((r) => String(r.publicAreaId) === areaId);
        }
        return enrichMaintenanceRequests(rows);
    },
    async get(id) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        return enrichMaintenanceRequest(await getRequestOrThrow(resolved));
    },
    async create(input) {
        const body = sanitizeMaintenanceRequestInput(input);
        if (body.roomId != null) {
            const roomKey = String(body.roomId).trim();
            if (roomKey) {
                body.roomId = (await resolveRoomIdForMaintenance(roomKey)) ?? roomKey;
            }
            else {
                body.roomId = null;
            }
        }
        if (body.publicAreaId != null) {
            const areaKey = String(body.publicAreaId).trim();
            if (areaKey) {
                body.publicAreaId =
                    (await resolvePublicAreaId(areaKey)) ?? areaKey;
            }
            else {
                body.publicAreaId = null;
            }
        }
        if (!body.roomId && !body.publicAreaId) {
            throw new AppError("roomId or publicAreaId is required", 400);
        }
        const title = String(body.title ?? "").trim();
        const description = String(body.description ?? "").trim();
        if (!title)
            throw new AppError("title is required", 400);
        if (!description)
            throw new AppError("description is required", 400);
        body.title = title;
        body.description = description;
        body.issueType = normalizeMaintenanceIssueType(body.issueType ?? title);
        body.priority = normalizeMaintenanceRequestPriority(body.priority ?? "MEDIUM");
        const assignedRaw = String(body.assignedTo ?? "").trim();
        const assigneeLabel = (await resolveMaintenanceAssigneeLabel(assignedRaw)) || assignedRaw;
        const resolvedAssignee = assignedRaw
            ? await resolveMaintenanceAssignee(assignedRaw)
            : null;
        const reportedRaw = String(body.reportedBy ?? "").trim();
        const reportedLabel = (await resolveMaintenanceAssigneeLabel(reportedRaw)) || reportedRaw;
        body.reportedBy = reportedRaw
            ? await resolveMaintenanceAssignee(reportedRaw)
            : null;
        if (!body.status) {
            body.status = resolvedAssignee ? "ASSIGNED" : "OPEN";
        }
        body.status = normalizeMaintenanceRequestStatus(body.status);
        const now = new Date();
        const nowIso = now.toISOString();
        if (!body.reportedAt)
            body.reportedAt = nowIso;
        if (resolvedAssignee && !body.assignedAt)
            body.assignedAt = nowIso;
        if (body.estimatedCompletionAt != null) {
            body.estimatedCompletionAt =
                parseEstimatedCompletionAt(body.estimatedCompletionAt, now) ??
                    (String(body.estimatedCompletionAt).includes("T")
                        ? String(body.estimatedCompletionAt)
                        : null);
        }
        if (body.blocksRoom == null) {
            body.blocksRoom =
                body.priority === "HIGH" || body.priority === "CRITICAL";
        }
        if (!body.id)
            body.id = hkModel.newId();
        const saved = await persistMaintenanceRequestRow({
            ...body,
            assignedTo: resolvedAssignee,
        }, { mode: "create" }, {
            assigned: assigneeLabel || undefined,
            reported: reportedLabel || undefined,
        });
        const row = await enrichMaintenanceRequest({
            ...saved,
            assignedTo: saved.assignedTo ?? resolvedAssignee ?? assigneeLabel,
            assignedToName: assigneeLabel || undefined,
            reportedByName: reportedLabel || undefined,
        });
        await appendHistory({
            user: reportedLabel || assigneeLabel || "Front Desk",
            category: "Maintenance",
            action: "Issue reported",
            room: row.roomNo ?? row.publicAreaName ?? undefined,
            details: `${row.requestNumber ?? row.id}: ${title} — ${description}`,
        });
        return row;
    },
    async update(id, input) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (existing.status === "CLOSED" || existing.status === "CANCELLED") {
            throw new ConflictError(`Cannot edit request in status ${existing.status}`);
        }
        const body = sanitizeMaintenanceRequestInput(input);
        const patch = {};
        if (body.title != null) {
            const title = String(body.title).trim();
            if (!title)
                throw new AppError("title is required", 400);
            patch.title = title;
        }
        if (body.description != null) {
            const description = String(body.description).trim();
            if (!description)
                throw new AppError("description is required", 400);
            patch.description = description;
        }
        if (body.issueType != null) {
            patch.issueType = normalizeMaintenanceIssueType(body.issueType);
        }
        if (body.priority != null) {
            patch.priority = normalizeMaintenanceRequestPriority(body.priority);
            patch.blocksRoom =
                patch.priority === "HIGH" || patch.priority === "CRITICAL";
        }
        if (body.notes != null) {
            patch.notes = String(body.notes).trim() || null;
        }
        if (body.resolution != null) {
            patch.resolution = String(body.resolution).trim() || null;
        }
        if (body.blocksRoom != null) {
            patch.blocksRoom = Boolean(body.blocksRoom);
        }
        if (!Object.keys(patch).length) {
            throw new AppError("No valid fields to update", 400);
        }
        const saved = await hkModel.update(hkModel.shared.maintenanceRequests, resolved, patch);
        return enrichMaintenanceRequest(saved);
    },
    async assign(id, assignedTo, estimatedCompletionAt) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (!ACTIVE_STATUSES.includes(existing.status)) {
            throw new ConflictError(`Cannot assign request in status ${existing.status}`);
        }
        const staff = assignedTo.trim();
        if (!staff)
            throw new AppError("assignedTo is required", 400);
        const resolvedStaff = await resolveMaintenanceAssignee(staff);
        const assigneeLabel = (await resolveMaintenanceAssigneeLabel(staff)) || staff;
        const now = new Date().toISOString();
        const patch = {
            status: "ASSIGNED",
            assignedTo: resolvedStaff,
            assignedAt: now,
        };
        if (estimatedCompletionAt) {
            patch.estimatedCompletionAt =
                parseEstimatedCompletionAt(estimatedCompletionAt) ??
                    estimatedCompletionAt;
        }
        const saved = await persistMaintenanceRequestRow(patch, { mode: "update", id: resolved }, { assigned: assigneeLabel });
        const row = await enrichMaintenanceRequest({
            ...saved,
            assignedTo: saved.assignedTo ?? resolvedStaff ?? assigneeLabel,
            assignedToName: assigneeLabel,
        });
        await appendHistory({
            user: staff,
            category: "Maintenance",
            action: "Issue assigned",
            room: row.roomNo ?? row.publicAreaName ?? undefined,
            details: `${row.requestNumber ?? resolved} assigned to ${staff}`,
        });
        return row;
    },
    async start(id) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (!["OPEN", "ASSIGNED"].includes(existing.status)) {
            throw new ConflictError(`Cannot start request in status ${existing.status}`);
        }
        const now = new Date().toISOString();
        return enrichMaintenanceRequest(await hkModel.update(hkModel.shared.maintenanceRequests, resolved, {
            status: "IN_PROGRESS",
            startedAt: existing.startedAt ?? now,
        }));
    },
    async complete(id, resolution, notes) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (existing.status === "CLOSED") {
            throw new ConflictError("Request is already closed");
        }
        if (existing.status === "CANCELLED") {
            throw new ConflictError("Cannot complete a cancelled request");
        }
        const now = new Date().toISOString();
        const row = await enrichMaintenanceRequest(await hkModel.update(hkModel.shared.maintenanceRequests, resolved, {
            status: "AWAITING_VERIFICATION",
            completedAt: now,
            resolution: resolution ?? existing.resolution,
            notes: notes ?? existing.notes,
        }));
        await appendHistory({
            user: String(existing.assignedTo ?? "Engineer"),
            category: "Maintenance",
            action: "Repair completed",
            room: row.roomNo ?? row.publicAreaName ?? undefined,
            details: `${row.requestNumber ?? resolved} awaiting verification`,
        });
        return row;
    },
    async verify(id, verifiedBy, resolution) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (existing.status !== "AWAITING_VERIFICATION") {
            throw new ConflictError(`Cannot verify request in status ${existing.status}`);
        }
        const verifierRaw = verifiedBy.trim();
        if (!verifierRaw)
            throw new AppError("verifiedBy is required", 400);
        const verifierLabel = (await resolveMaintenanceAssigneeLabel(verifierRaw)) || verifierRaw;
        const resolvedVerifier = await resolveMaintenanceAssignee(verifierRaw);
        const now = new Date().toISOString();
        const saved = await persistMaintenanceRequestRow({
            status: "CLOSED",
            verifiedAt: now,
            verifiedBy: resolvedVerifier,
            resolution: resolution ?? existing.resolution,
            blocksRoom: false,
        }, { mode: "update", id: resolved }, { verified: verifierLabel });
        const row = await enrichMaintenanceRequest({
            ...saved,
            verifiedBy: saved.verifiedBy ?? resolvedVerifier ?? verifierLabel,
            verifiedByName: verifierLabel,
        });
        await appendHistory({
            user: verifierLabel,
            category: "Maintenance",
            action: "Issue verified & closed",
            room: row.roomNo ?? row.publicAreaName ?? undefined,
            details: `${row.requestNumber ?? resolved} closed`,
        });
        return row;
    },
    async cancel(id, notes) {
        const resolved = await resolveMaintenanceRequestId(id);
        if (!resolved)
            throw new NotFoundError("Maintenance request not found");
        const existing = await getRequestOrThrow(resolved);
        if (existing.status === "CLOSED") {
            throw new ConflictError("Cannot cancel a closed request");
        }
        return enrichMaintenanceRequest(await hkModel.update(hkModel.shared.maintenanceRequests, resolved, {
            status: "CANCELLED",
            notes: notes ?? existing.notes,
            blocksRoom: false,
        }));
    },
};
//# sourceMappingURL=maintenance-request.service.js.map
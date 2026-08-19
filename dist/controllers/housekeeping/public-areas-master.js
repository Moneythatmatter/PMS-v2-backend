import { supabase } from "../../utils/supabase.js";
import { hkModel } from "../../models/housekeeping/index.js";
import { toCamel } from "../../utils/mappers.js";
import { sanitizePublicAreaInput } from "../../services/housekeeping/public-area-sanitize.js";
import { normalizePublicAreaPriority, } from "../../types/housekeeping.js";
import { fail, fromError, ok } from "../../utils/response.js";
async function findByKey(key) {
    const trimmed = key.trim();
    if (!trimmed)
        return null;
    const byId = await hkModel.get(hkModel.tables.publicAreasMaster, trimmed);
    if (byId)
        return byId;
    const { data, error } = await supabase
        .from(hkModel.tables.publicAreasMaster)
        .select("*")
        .eq("area_code", trimmed)
        .maybeSingle();
    if (error)
        throw new Error(error.message);
    return data ? toCamel(data) : null;
}
export async function listPublicAreasMaster(req, res) {
    try {
        const isActive = req.query.isActive;
        const areaType = req.query.areaType;
        const filters = {};
        if (areaType)
            filters.area_type = areaType;
        if (isActive === "true")
            filters.is_active = true;
        if (isActive === "false")
            filters.is_active = false;
        const rows = await hkModel.list(hkModel.tables.publicAreasMaster, {
            filters,
            orderBy: "area_code",
            ascending: true,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getPublicAreaMaster(req, res) {
    try {
        const row = await findByKey(String(req.params.id));
        if (!row)
            return fail(res, "Public area not found", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createPublicAreaMaster(req, res) {
    try {
        const body = sanitizePublicAreaInput(req.body);
        if (!body.areaCode || !String(body.areaCode).trim()) {
            return fail(res, "areaCode is required", 400);
        }
        if (!body.name || !String(body.name).trim()) {
            return fail(res, "name is required", 400);
        }
        if (!body.id)
            body.id = hkModel.newId();
        if (!body.areaType)
            body.areaType = "Lobby";
        if (!body.priority)
            body.priority = "MEDIUM";
        body.priority = normalizePublicAreaPriority(body.priority);
        if (body.isActive === undefined)
            body.isActive = true;
        if (body.floorNumber === "")
            body.floorNumber = null;
        const row = await hkModel.create(hkModel.tables.publicAreasMaster, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updatePublicAreaMaster(req, res) {
    try {
        const existing = await findByKey(String(req.params.id));
        if (!existing)
            return fail(res, "Public area not found", 404);
        const body = sanitizePublicAreaInput(req.body);
        delete body.id;
        delete body.areaCode;
        if (body.priority != null) {
            body.priority = normalizePublicAreaPriority(body.priority);
        }
        if (body.floorNumber === "")
            body.floorNumber = null;
        const row = await hkModel.update(hkModel.tables.publicAreasMaster, existing.id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deletePublicAreaMaster(req, res) {
    try {
        const existing = await findByKey(String(req.params.id));
        if (!existing)
            return fail(res, "Public area not found", 404);
        await hkModel.remove(hkModel.tables.publicAreasMaster, existing.id);
        return ok(res, { id: existing.id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=public-areas-master.js.map
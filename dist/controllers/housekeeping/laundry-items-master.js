import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
function sanitizeItem(body) {
    const out = { ...body };
    delete out.sortOrder;
    if (typeof out.itemCode === "string") {
        out.itemCode = out.itemCode.trim().toUpperCase();
    }
    if (typeof out.name === "string")
        out.name = out.name.trim();
    if (typeof out.category === "string")
        out.category = out.category.trim();
    if (typeof out.description === "string") {
        out.description = out.description.trim() || null;
    }
    return out;
}
export async function listLaundryItems(req, res) {
    try {
        const isActive = req.query.isActive;
        const filters = {};
        if (isActive === "true")
            filters.is_active = true;
        if (isActive === "false")
            filters.is_active = false;
        const rows = await hkModel.list(hkModel.tables.laundryItems, {
            filters,
            orderBy: "name",
            ascending: true,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getLaundryItem(req, res) {
    try {
        const row = await hkModel.get(hkModel.tables.laundryItems, String(req.params.id));
        if (!row)
            return fail(res, "Laundry item not found", 404);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createLaundryItem(req, res) {
    try {
        const body = sanitizeItem({ ...req.body });
        if (!body.itemCode)
            return fail(res, "itemCode is required", 400);
        if (!body.name)
            return fail(res, "name is required", 400);
        if (!body.id)
            body.id = hkModel.newId("LI");
        if (!body.category)
            body.category = "Garment";
        if (body.isActive === undefined)
            body.isActive = true;
        const row = await hkModel.create(hkModel.tables.laundryItems, body);
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateLaundryItem(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.laundryItems, id);
        if (!existing)
            return fail(res, "Laundry item not found", 404);
        const body = sanitizeItem({ ...req.body });
        delete body.id;
        const row = await hkModel.update(hkModel.tables.laundryItems, id, body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteLaundryItem(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await hkModel.get(hkModel.tables.laundryItems, id);
        if (!existing)
            return fail(res, "Laundry item not found", 404);
        await hkModel.remove(hkModel.tables.laundryItems, id);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=laundry-items-master.js.map
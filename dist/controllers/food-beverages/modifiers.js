import * as modifiers from "../../models/food-beverages/modifiers.js";
import { NotFoundError } from "../../errors/index.js";
import { fromError, ok } from "../../utils/response.js";
export async function listGroups(_req, res) {
    try {
        return ok(res, await modifiers.listGroups());
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getGroup(req, res) {
    try {
        const row = await modifiers.getGroup(String(req.params.id));
        if (!row)
            throw new NotFoundError("Modifier group not found");
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createGroup(req, res) {
    try {
        const row = await modifiers.saveGroup(null, { ...req.body });
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateGroup(req, res) {
    try {
        const id = String(req.params.id);
        if (!(await modifiers.getGroup(id)))
            throw new NotFoundError("Modifier group not found");
        const row = await modifiers.saveGroup(id, { ...req.body });
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function deleteGroup(req, res) {
    try {
        const id = String(req.params.id);
        await modifiers.deleteGroup(id);
        return ok(res, { id });
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=modifiers.js.map
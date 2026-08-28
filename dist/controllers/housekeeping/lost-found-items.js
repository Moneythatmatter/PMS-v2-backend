import { LostFoundItemService } from "../../services/housekeeping/lost-found-item.service.js";
import { fromError, ok } from "../../utils/response.js";
export async function listLostFoundItems(req, res) {
    try {
        const rows = await LostFoundItemService.list({
            status: req.query.status,
            roomId: req.query.roomId,
        });
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getLostFoundItem(req, res) {
    try {
        return ok(res, await LostFoundItemService.get(String(req.params.id)));
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function createLostFoundItem(req, res) {
    try {
        const row = await LostFoundItemService.create((req.body ?? {}));
        return ok(res, row, 201);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function updateLostFoundItem(req, res) {
    try {
        const row = await LostFoundItemService.update(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function returnLostFoundItem(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await LostFoundItemService.returnItem(String(req.params.id), body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function claimLostFoundItem(req, res) {
    try {
        const body = (req.body ?? {});
        const row = await LostFoundItemService.claimItem(String(req.params.id), body);
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function disposeLostFoundItem(req, res) {
    try {
        const row = await LostFoundItemService.disposeItem(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function courierLostFoundItem(req, res) {
    try {
        const row = await LostFoundItemService.courierDispatch(String(req.params.id), (req.body ?? {}));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=lost-found-items.js.map
import { deleteRow, getRowById, insertRow, listRows, newId, updateRow, } from "../models/front-office/base.js";
import { fail, fromError, ok } from "../utils/response.js";
export function createTableCrud(options) {
    const idCol = options.idColumn ?? "id";
    return {
        async list(req, res) {
            try {
                const filters = options.listFilters?.(req) ?? {};
                let rows = await listRows(options.table, {
                    filters,
                    orderBy: options.orderBy ?? idCol,
                });
                if (options.mapOutgoing) {
                    rows = rows.map((r) => options.mapOutgoing(r));
                }
                return ok(res, rows);
            }
            catch (e) {
                return fromError(res, e);
            }
        },
        async get(req, res) {
            try {
                const id = String(req.params.id);
                let row = await getRowById(options.table, id, idCol);
                if (!row)
                    return fail(res, "Not found", 404);
                if (options.mapOutgoing)
                    row = options.mapOutgoing(row);
                return ok(res, row);
            }
            catch (e) {
                return fromError(res, e);
            }
        },
        async create(req, res) {
            try {
                let body = { ...req.body };
                if (options.mapIncoming)
                    body = options.mapIncoming(body);
                if (!body[idCol])
                    body[idCol] = newId(options.idPrefix);
                let row = await insertRow(options.table, body);
                if (options.mapOutgoing)
                    row = options.mapOutgoing(row);
                return ok(res, row, 201);
            }
            catch (e) {
                return fromError(res, e);
            }
        },
        async update(req, res) {
            try {
                const id = String(req.params.id);
                let body = { ...req.body };
                delete body[idCol];
                delete body.id;
                if (options.mapIncoming)
                    body = options.mapIncoming(body);
                let row = await updateRow(options.table, id, body, idCol);
                if (options.mapOutgoing)
                    row = options.mapOutgoing(row);
                return ok(res, row);
            }
            catch (e) {
                return fromError(res, e);
            }
        },
        async remove(req, res) {
            try {
                const id = String(req.params.id);
                await deleteRow(options.table, id, idCol);
                return ok(res, { id });
            }
            catch (e) {
                return fromError(res, e);
            }
        },
    };
}
export function mountCrud(router, path, controller) {
    router.get(path, controller.list);
    router.get(`${path}/:id`, controller.get);
    router.post(path, controller.create);
    router.put(`${path}/:id`, controller.update);
    router.patch(`${path}/:id`, controller.update);
    router.delete(`${path}/:id`, controller.remove);
}
//# sourceMappingURL=shared-crud.js.map
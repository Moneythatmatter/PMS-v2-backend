import { foModel } from "../../models/front-office/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";
export function createCrudController(options) {
    const idCol = options.idColumn ?? "id";
    async function resolvePrimaryKey(key) {
        if (options.resolveId) {
            const resolved = await options.resolveId(key);
            if (resolved)
                return resolved;
        }
        return key;
    }
    return {
        async list(req, res) {
            try {
                const filters = options.listFilters?.(req) ?? {};
                let rows = await foModel.list(options.table, {
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
                const id = await resolvePrimaryKey(String(req.params.id));
                let row = await foModel.get(options.table, id, idCol);
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
                if (options.createSchema) {
                    body = parseBody(options.createSchema, body);
                }
                if (options.beforeCreate) {
                    await options.beforeCreate(body);
                }
                if (!body[idCol]) {
                    body[idCol] = foModel.newId(options.idPrefix);
                }
                let row = await foModel.create(options.table, body);
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
                const id = await resolvePrimaryKey(String(req.params.id));
                let body = { ...req.body };
                delete body[idCol];
                delete body.id;
                if (options.mapIncoming)
                    body = options.mapIncoming(body);
                if (options.updateSchema) {
                    body = parseBody(options.updateSchema, body);
                }
                if (options.beforeUpdate) {
                    await options.beforeUpdate(id, body);
                }
                let row = await foModel.update(options.table, id, body, idCol);
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
                const id = await resolvePrimaryKey(String(req.params.id));
                await foModel.remove(options.table, id, idCol);
                return ok(res, { id });
            }
            catch (e) {
                return fromError(res, e);
            }
        },
    };
}
export function mountCrud(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router, path, controller) {
    router.get(path, controller.list);
    router.get(`${path}/:id`, controller.get);
    router.post(path, controller.create);
    router.put(`${path}/:id`, controller.update);
    router.patch(`${path}/:id`, controller.update);
    router.delete(`${path}/:id`, controller.remove);
}
//# sourceMappingURL=crud.js.map
import type { Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { foModel, type TableName } from "../../models/front-office/index.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { parseBody } from "../../utils/validate.js";

type CrudOptions = {
  table: TableName;
  idPrefix: string;
  idColumn?: string;
  listFilters?: (req: Request) => Record<string, string | undefined>;
  orderBy?: string;
  mapIncoming?: (body: Record<string, unknown>) => Record<string, unknown>;
  mapOutgoing?: <T>(row: T) => T;
  /** Zod schema for POST body */
  createSchema?: ZodTypeAny;
  /** Zod schema for PUT/PATCH body */
  updateSchema?: ZodTypeAny;
  /** Resolve route key (UUID or human-readable no) to primary key */
  resolveId?: (key: string) => Promise<string | null>;
  beforeCreate?: (body: Record<string, unknown>) => Promise<void>;
  beforeUpdate?: (id: string, body: Record<string, unknown>) => Promise<void>;
  afterList?: <T>(rows: T[]) => Promise<T[]>;
  afterGet?: <T>(row: T) => Promise<T>;
};

export function createCrudController(options: CrudOptions) {
  const idCol = options.idColumn ?? "id";

  async function resolvePrimaryKey(key: string): Promise<string> {
    if (options.resolveId) {
      const resolved = await options.resolveId(key);
      if (resolved) return resolved;
    }
    return key;
  }

  return {
    async list(req: Request, res: Response) {
      try {
        const filters = options.listFilters?.(req) ?? {};
        let rows = await foModel.list(options.table, {
          filters,
          orderBy: options.orderBy ?? idCol,
        });
        if (options.mapOutgoing) {
          rows = rows.map((r) => options.mapOutgoing!(r));
        }
        if (options.afterList) {
          rows = await options.afterList(rows);
        }
        return ok(res, rows);
      } catch (e) {
        return fromError(res, e);
      }
    },

    async get(req: Request, res: Response) {
      try {
        const id = await resolvePrimaryKey(String(req.params.id));
        let row = await foModel.get(options.table, id, idCol);
        if (!row) return fail(res, "Not found", 404);
        if (options.mapOutgoing) row = options.mapOutgoing(row);
        if (options.afterGet) row = await options.afterGet(row);
        return ok(res, row);
      } catch (e) {
        return fromError(res, e);
      }
    },

    async create(req: Request, res: Response) {
      try {
        let body = { ...(req.body as Record<string, unknown>) };
        if (options.mapIncoming) body = options.mapIncoming(body);
        if (options.createSchema) {
          body = parseBody(options.createSchema, body) as Record<string, unknown>;
        }
        if (options.beforeCreate) {
          await options.beforeCreate(body);
        }
        if (!body[idCol]) {
          body[idCol] = foModel.newId(options.idPrefix);
        }
        let row = await foModel.create(options.table, body);
        if (options.mapOutgoing) row = options.mapOutgoing(row);
        if (options.afterGet) row = await options.afterGet(row);
        return ok(res, row, 201);
      } catch (e) {
        return fromError(res, e);
      }
    },

    async update(req: Request, res: Response) {
      try {
        const id = await resolvePrimaryKey(String(req.params.id));
        let body = { ...(req.body as Record<string, unknown>) };
        delete body[idCol];
        delete body.id;
        if (options.mapIncoming) body = options.mapIncoming(body);
        if (options.updateSchema) {
          body = parseBody(options.updateSchema, body) as Record<string, unknown>;
        }
        if (options.beforeUpdate) {
          await options.beforeUpdate(id, body);
        }
        let row = await foModel.update(options.table, id, body, idCol);
        if (options.mapOutgoing) row = options.mapOutgoing(row);
        if (options.afterGet) row = await options.afterGet(row);
        return ok(res, row);
      } catch (e) {
        return fromError(res, e);
      }
    },

    async remove(req: Request, res: Response) {
      try {
        const id = await resolvePrimaryKey(String(req.params.id));
        await foModel.remove(options.table, id, idCol);
        return ok(res, { id });
      } catch (e) {
        return fromError(res, e);
      }
    },
  };
}

export function mountCrud(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: any,
  path: string,
  controller: ReturnType<typeof createCrudController>,
) {
  router.get(path, controller.list);
  router.get(`${path}/:id`, controller.get);
  router.post(path, controller.create);
  router.put(`${path}/:id`, controller.update);
  router.patch(`${path}/:id`, controller.update);
  router.delete(`${path}/:id`, controller.remove);
}

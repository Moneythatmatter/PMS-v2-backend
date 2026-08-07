import type { Request, Response } from "express";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { fail, fromError, ok } from "../../utils/response.js";
import { newId } from "../../models/front-office/base.js";

const TABLE = "fb_module_records";

function flatten(row: Record<string, unknown>) {
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};
  return toCamel({
    id: row.id,
    moduleKey: row.module_key,
    ...payload,
    createdAt: row.created_at,
  });
}

export function createModuleRecordsCrud(moduleKey: string, idPrefix: string) {
  return {
    async list(_req: Request, res: Response) {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select("*")
          .eq("module_key", moduleKey)
          .order("created_at", { ascending: false });
        if (error) {
          // Table not applied yet — return empty list so UI stays usable
          if (/fb_module_records|schema cache|does not exist/i.test(error.message)) {
            return ok(res, []);
          }
          throw new Error(error.message);
        }
        return ok(res, (data ?? []).map((r) => flatten(r as Record<string, unknown>)));
      } catch (e) {
        return fromError(res, e);
      }
    },

    async get(req: Request, res: Response) {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select("*")
          .eq("module_key", moduleKey)
          .eq("id", String(req.params.id))
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail(res, "Not found", 404);
        return ok(res, flatten(data as Record<string, unknown>));
      } catch (e) {
        return fromError(res, e);
      }
    },

    async create(req: Request, res: Response) {
      try {
        const body = { ...(req.body as Record<string, unknown>) };
        const id = String(body.id ?? newId(idPrefix));
        delete body.id;
        delete body.moduleKey;
        delete body.createdAt;
        const { data, error } = await supabase
          .from(TABLE)
          .insert({ id, module_key: moduleKey, payload: body })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return ok(res, flatten(data as Record<string, unknown>), 201);
      } catch (e) {
        return fromError(res, e);
      }
    },

    async update(req: Request, res: Response) {
      try {
        const id = String(req.params.id);
        const body = { ...(req.body as Record<string, unknown>) };
        delete body.id;
        delete body.moduleKey;
        delete body.createdAt;

        const existing = await supabase
          .from(TABLE)
          .select("payload")
          .eq("module_key", moduleKey)
          .eq("id", id)
          .maybeSingle();
        if (existing.error) throw new Error(existing.error.message);
        if (!existing.data) return fail(res, "Not found", 404);

        const prev =
          existing.data.payload && typeof existing.data.payload === "object"
            ? (existing.data.payload as Record<string, unknown>)
            : {};
        const { data, error } = await supabase
          .from(TABLE)
          .update({ payload: { ...prev, ...body } })
          .eq("module_key", moduleKey)
          .eq("id", id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return ok(res, flatten(data as Record<string, unknown>));
      } catch (e) {
        return fromError(res, e);
      }
    },

    async remove(req: Request, res: Response) {
      try {
        const { error } = await supabase
          .from(TABLE)
          .delete()
          .eq("module_key", moduleKey)
          .eq("id", String(req.params.id));
        if (error) throw new Error(error.message);
        return ok(res, { id: String(req.params.id) });
      } catch (e) {
        return fromError(res, e);
      }
    },
  };
}

export function mountModuleRecords(
  router: import("express").Router,
  path: string,
  moduleKey: string,
  idPrefix: string,
) {
  const c = createModuleRecordsCrud(moduleKey, idPrefix);
  router.get(path, c.list);
  router.get(`${path}/:id`, c.get);
  router.post(path, c.create);
  router.put(`${path}/:id`, c.update);
  router.patch(`${path}/:id`, c.update);
  router.delete(`${path}/:id`, c.remove);
}

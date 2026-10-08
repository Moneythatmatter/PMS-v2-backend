import type { Request, Response } from "express";
import * as recipes from "../../models/food-beverages/recipes.js";
import {
  consumeRecipeById,
  listConsumptions as listConsumptionRows,
} from "../../services/food-beverages/recipe-consumption.service.js";
import { NotFoundError } from "../../errors/index.js";
import { fromError, ok } from "../../utils/response.js";

const queryValue = (v: unknown) => (typeof v === "string" && v.trim() && v !== "all" ? v.trim() : undefined);

export async function listRecipes(req: Request, res: Response) {
  try {
    const status = queryValue(req.query.status);
    const rows = await recipes.listRecipes({
      active: status === "Active" ? true : status === "Inactive" ? false : undefined,
      categoryId: queryValue(req.query.categoryId),
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function getRecipe(req: Request, res: Response) {
  try {
    const row = await recipes.getRecipe(String(req.params.id));
    if (!row) throw new NotFoundError("Recipe not found");
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function createRecipe(req: Request, res: Response) {
  try {
    const row = await recipes.createRecipe({ ...(req.body as Record<string, unknown>) });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function updateRecipe(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    if (!(await recipes.getRecipe(id))) throw new NotFoundError("Recipe not found");
    const row = await recipes.updateRecipe(id, { ...(req.body as Record<string, unknown>) });
    return ok(res, row);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function deleteRecipe(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    await recipes.deleteRecipe(id);
    return ok(res, { id });
  } catch (e) {
    return fromError(res, e);
  }
}

/** POST /:id/consume — the only manual way a recipe moves stock (batch prep, staff meal, banquet). */
export async function consumeRecipe(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = await consumeRecipeById(String(req.params.id), {
      portions: Number(body.portions),
      warehouseId: queryValue(body.warehouseId),
      reference: queryValue(body.reference),
      remarks: queryValue(body.remarks),
      consumedBy: queryValue(body.consumedBy),
    });
    return ok(res, row, 201);
  } catch (e) {
    return fromError(res, e);
  }
}

export async function listConsumptions(req: Request, res: Response) {
  try {
    const rows = await listConsumptionRows({
      recipeId: queryValue(req.params.id) ?? queryValue(req.query.recipeId),
    });
    return ok(res, rows);
  } catch (e) {
    return fromError(res, e);
  }
}

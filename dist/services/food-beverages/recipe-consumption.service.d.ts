import { type Recipe } from "../../models/food-beverages/recipes.js";
type SourceType = "POS Sale" | "Manual";
export type ConsumptionLine = {
    materialId: string;
    productCode: string;
    materialName: string;
    stockUnit: string;
    quantity: number;
    unitCost: number;
    value: number;
    balanceAfter: number;
};
export type RecipeConsumption = {
    id: string;
    consumptionNo: string;
    recipeId: string;
    sourceType: SourceType;
    sourceRef: string;
    menuItemId: string | null;
    portions: number;
    warehouseId: string;
    totalCost: number;
    lines: ConsumptionLine[];
    remarks: string;
    consumedBy: string;
    consumedAt: string;
};
/** Stock each ingredient needs for `portions`, in the material's stock unit. */
export declare function consumptionPlan(recipe: Recipe, portions: number): {
    ingredient: import("../../models/food-beverages/recipes.js").RecipeIngredient;
    quantity: number;
}[];
/**
 * Deduct a recipe's ingredients from one store and post them to the stock ledger.
 * POS sales are idempotent per (order, recipe) and may drive stock negative, because the food is already sold;
 * manual entries are refused when the store is short.
 */
export declare function consumeRecipe(input: {
    recipe: Recipe;
    portions: number;
    sourceType: SourceType;
    sourceRef?: string;
    warehouseId?: string | null;
    menuItemId?: string | null;
    remarks?: string;
    consumedBy?: string;
}): Promise<RecipeConsumption | null>;
export declare function consumeRecipeById(recipeId: string, input: {
    portions: number;
    warehouseId?: string;
    remarks?: string;
    reference?: string;
    consumedBy?: string;
}): Promise<RecipeConsumption | null>;
/** Deduct ingredients for every recipe-linked item on a settled order. Safe to call more than once. */
export declare function consumeRecipesForOrder(orderId: string): Promise<RecipeConsumption[]>;
export declare function listConsumptions(filters?: {
    recipeId?: string;
    limit?: number;
}): Promise<RecipeConsumption[]>;
export {};

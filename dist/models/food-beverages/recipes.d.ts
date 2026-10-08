export declare const recipeTables: {
    readonly recipes: "fb_recipes";
    readonly ingredients: "fb_recipe_ingredients";
    readonly consumptions: "fb_recipe_consumptions";
};
export type RecipeIngredient = {
    id: string;
    lineNo: number;
    materialId: string;
    productCode: string;
    materialName: string;
    category: string;
    quantity: number;
    unit: string;
    stockUnit: string;
    conversionFactor: number;
    /** Net quantity per batch in the material's stock unit. */
    stockQuantity: number;
    wastagePercent: number;
    /** Stock units actually drawn per batch after ingredient and recipe wastage. */
    grossStockQuantity: number;
    unitCost: number;
    lineCost: number;
    onHandIssueStore: number | null;
    onHandTotal: number;
    remarks: string;
};
export type Recipe = {
    id: string;
    recipeCode: string;
    name: string;
    categoryId: string | null;
    categoryName: string;
    menuItemId: string | null;
    menuItemName: string;
    menuItemPrice: number | null;
    yieldQuantity: number;
    yieldUnit: string;
    sellingPrice: number;
    wastagePercent: number;
    prepTimeMinutes: number | null;
    issueWarehouseId: string | null;
    issueWarehouseName: string;
    instructions: string;
    notes: string;
    isActive: boolean;
    status: "Active" | "Inactive";
    batchCost: number;
    costPerPortion: number;
    foodCostPercent: number;
    ingredients: RecipeIngredient[];
    createdAt: string;
    updatedAt: string;
};
type ProductRow = {
    id: string;
    productCode: string;
    productName: string;
    category: string;
    unit: string;
    status: string;
};
type BalanceRow = {
    materialId: string;
    warehouseId: string;
    quantity: number;
    averageCost: number;
};
export declare function loadProducts(ids: string[]): Promise<Map<string, ProductRow>>;
export declare function loadBalances(materialIds: string[]): Promise<BalanceRow[]>;
export declare function grossStockQuantity(stockQuantity: number, ingredientWastage: number, recipeWastage: number): number;
export declare function listRecipes(filters?: {
    active?: boolean;
    categoryId?: string;
}): Promise<Recipe[]>;
export declare function getRecipe(id: string): Promise<Recipe | null>;
export declare function listActiveRecipesForMenuItems(menuItemIds: string[]): Promise<Recipe[]>;
export declare function createRecipe(body: Record<string, unknown>): Promise<Recipe>;
export declare function updateRecipe(id: string, body: Record<string, unknown>): Promise<Recipe>;
export declare function deleteRecipe(id: string): Promise<void>;
export {};

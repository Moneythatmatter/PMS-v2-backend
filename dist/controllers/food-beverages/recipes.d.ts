import type { Request, Response } from "express";
export declare function listRecipes(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function getRecipe(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function createRecipe(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function updateRecipe(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function deleteRecipe(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
/** POST /:id/consume — the only manual way a recipe moves stock (batch prep, staff meal, banquet). */
export declare function consumeRecipe(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
export declare function listConsumptions(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;

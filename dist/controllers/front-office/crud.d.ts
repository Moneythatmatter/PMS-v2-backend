import type { Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { type TableName } from "../../models/front-office/index.js";
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
};
export declare function createCrudController(options: CrudOptions): {
    list(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    get(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    create(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    update(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    remove(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
};
export declare function mountCrud(router: any, path: string, controller: ReturnType<typeof createCrudController>): void;
export {};

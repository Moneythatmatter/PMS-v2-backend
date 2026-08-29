import type { Request, Response, Router } from "express";
type CrudOptions = {
    table: string;
    idPrefix: string;
    idColumn?: string;
    listFilters?: (req: Request) => Record<string, string | undefined>;
    orderBy?: string;
    mapIncoming?: (body: Record<string, unknown>, ctx?: {
        isCreate: boolean;
    }) => Record<string, unknown>;
    mapOutgoing?: <T>(row: T) => T;
};
export declare function createTableCrud(options: CrudOptions): {
    list(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    get(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    create(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    update(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    remove(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
};
export declare function mountCrud(router: Router, path: string, controller: ReturnType<typeof createTableCrud>): void;
export {};

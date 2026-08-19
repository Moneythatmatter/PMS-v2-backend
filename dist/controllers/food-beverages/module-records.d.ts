import type { Request, Response } from "express";
export declare function createModuleRecordsCrud(moduleKey: string, idPrefix: string): {
    list(_req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    get(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    create(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    update(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    remove(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
};
export declare function mountModuleRecords(router: import("express").Router, path: string, moduleKey: string, idPrefix: string): void;

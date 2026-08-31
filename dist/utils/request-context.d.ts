import { AsyncLocalStorage } from "node:async_hooks";
export type RequestStore = {
    userId?: string;
    userRole?: string;
    isSuperAdmin?: boolean;
    propertyId?: string;
};
export declare const requestContext: AsyncLocalStorage<RequestStore>;
export declare function getRequestStore(): RequestStore | undefined;
export declare function getActivePropertyId(): string | undefined;
export declare function runWithRequestStore<T>(store: RequestStore, fn: () => T): T;

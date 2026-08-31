import { AsyncLocalStorage } from "node:async_hooks";

export type RequestStore = {
  userId?: string;
  userRole?: string;
  isSuperAdmin?: boolean;
  propertyId?: string;
};

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getRequestStore(): RequestStore | undefined {
  return requestContext.getStore();
}

export function getActivePropertyId(): string | undefined {
  return requestContext.getStore()?.propertyId;
}

export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return requestContext.run(store, fn);
}

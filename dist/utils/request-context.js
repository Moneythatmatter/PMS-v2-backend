import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage();
export function getRequestStore() {
    return requestContext.getStore();
}
export function getActivePropertyId() {
    return requestContext.getStore()?.propertyId;
}
export function runWithRequestStore(store, fn) {
    return requestContext.run(store, fn);
}
//# sourceMappingURL=request-context.js.map
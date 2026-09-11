import type { AuthUserRow, EmployeePortalContext } from "../../types/auth.js";
export type ResolvedEmployeeContext = {
    user: AuthUserRow;
    employeeId: string;
    propertyId: string;
    employee: EmployeePortalContext;
};
export declare function buildEmployeePortalContext(employeeId: string): Promise<EmployeePortalContext | null>;
export declare function resolveEmployeeContextForUser(userId: string, opts?: {
    isSuperAdmin?: boolean;
    role?: string;
}): Promise<ResolvedEmployeeContext>;
export declare function assertOwnEmployeeRecord(record: {
    employeeId?: string | null;
    propertyId?: string | null;
}, ctx: {
    employeeId: string;
    propertyId: string;
}): void;

import type { AuthUserPublic } from "../../types/auth.js";
import type { PermissionLevel, UserPermissionRow, UserPropertyAccessRow } from "../../types/platform.js";
export type ManagedUser = AuthUserPublic & {
    status: string;
    propertyIds: string[];
    permissions: UserPermissionRow[];
};
export declare const UserAdminService: {
    assertSuperAdmin(isSuperAdmin?: boolean, role?: string): void;
    listUsers(): Promise<ManagedUser[]>;
    createUser(input: {
        name: string;
        email: string;
        password: string;
        role?: string;
        initials?: string;
        isSuperAdmin?: boolean;
        propertyIds?: string[];
        permissions?: Array<{
            propertyId: string;
            moduleKey: string;
            permission: PermissionLevel;
        }>;
    }): Promise<ManagedUser>;
    setUserAccess(userId: string, input: {
        propertyIds: string[];
        permissions: Array<{
            propertyId: string;
            moduleKey: string;
            permission: PermissionLevel;
        }>;
    }): Promise<void>;
    updateUser(userId: string, patch: {
        name?: string;
        role?: string;
        status?: string;
        isSuperAdmin?: boolean;
        propertyIds?: string[];
        permissions?: Array<{
            propertyId: string;
            moduleKey: string;
            permission: PermissionLevel;
        }>;
    }): Promise<ManagedUser>;
    getMyPermissions(userId: string, propertyId: string, isSuperAdmin?: boolean): Promise<Record<string, PermissionLevel | "admin">>;
};
export type { UserPropertyAccessRow };

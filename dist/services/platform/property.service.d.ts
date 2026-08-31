import type { PropertyRow, UserPermissionRow } from "../../types/platform.js";
declare function initialsFromName(name: string): string;
export declare const PropertyService: {
    userCanAccessProperty(userId: string, propertyId: string, isSuperAdmin?: boolean, role?: string): Promise<boolean>;
    listForUser(userId: string, isSuperAdmin?: boolean, role?: string): Promise<PropertyRow[]>;
    create(input: {
        name: string;
        code: string;
        city?: string;
        timezone?: string;
        isDefault?: boolean;
    }): Promise<PropertyRow>;
    update(id: string, patch: Partial<Pick<PropertyRow, "name" | "code" | "city" | "timezone" | "status">>): Promise<PropertyRow>;
    getUserPermissions(userId: string, propertyId: string): Promise<UserPermissionRow[]>;
    userHasModulePermission(userId: string, propertyId: string, moduleKey: string, level: "read" | "write", isSuperAdmin?: boolean): Promise<boolean>;
    assertModulePermission(userId: string, propertyId: string, moduleKey: string, level: "read" | "write", isSuperAdmin?: boolean): void;
    initialsFromPropertyName: typeof initialsFromName;
};
export type { UserPropertyAccessRow, UserPermissionRow };

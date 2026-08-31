export declare const PLATFORM_MODULES: readonly [{
    readonly key: "dashboard";
    readonly label: "Dashboard";
}, {
    readonly key: "front_office";
    readonly label: "Front Office";
}, {
    readonly key: "food_beverages";
    readonly label: "Food & Beverages";
}, {
    readonly key: "housekeeping";
    readonly label: "Housekeeping";
}, {
    readonly key: "purchase_stores";
    readonly label: "Purchase & Stores";
}, {
    readonly key: "human_resources";
    readonly label: "Human Resources";
}, {
    readonly key: "accounts";
    readonly label: "Accounts";
}, {
    readonly key: "sales_marketing";
    readonly label: "Sales & Marketing";
}, {
    readonly key: "system_settings";
    readonly label: "System Settings";
}];
export type ModuleKey = (typeof PLATFORM_MODULES)[number]["key"];
export type PermissionLevel = "read" | "write" | "admin";
export type PropertyRow = {
    id: string;
    name: string;
    code: string;
    city: string;
    timezone: string;
    isDefault: boolean;
    status: string;
};
export type UserPermissionRow = {
    id: string;
    userId: string;
    propertyId: string;
    moduleKey: string;
    permission: PermissionLevel;
};
export type UserPropertyAccessRow = {
    userId: string;
    propertyId: string;
    isDefault: boolean;
};

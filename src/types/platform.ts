export const PLATFORM_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "front_office", label: "Front Office" },
  { key: "food_beverages", label: "Food & Beverages" },
  { key: "housekeeping", label: "Housekeeping" },
  { key: "purchase_stores", label: "Purchase & Stores" },
  { key: "human_resources", label: "Human Resources" },
  { key: "accounts", label: "Accounts" },
  { key: "sales_marketing", label: "Sales & Marketing" },
  { key: "system_settings", label: "System Settings" },
] as const;

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

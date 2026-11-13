export type PermissionLevel = "read" | "write" | "admin";

/** One assignable access row (stored in user_permissions.module_key). */
export type PlatformPage = {
  key: string;
  label: string;
  /** Route used for matching (optional for workspace-only keys). */
  path?: string;
};

export type PlatformAccessGroup = {
  key: string;
  label: string;
  pages: readonly PlatformPage[];
};

type Leaf = { label: string; path: string };

function pages(moduleKey: string, leaves: Leaf[]): PlatformPage[] {
  return leaves.map((leaf) => {
    const prefix =
      moduleKey === "front_office"
        ? "/frontoffice"
        : moduleKey === "food_beverages"
          ? "/food-beverages"
          : moduleKey === "purchase_stores"
            ? "/purchase-stores"
            : moduleKey === "human_resources"
              ? "/human-resources"
              : moduleKey === "sales_marketing"
                ? "/sales-marketing"
                : `/${moduleKey.replace(/_/g, "-")}`;
    let slug = leaf.path
      .split("?")[0]
      .replace(new RegExp(`^${prefix}/?`), "")
      .replace(/\//g, "_")
      .replace(/-/g, "_");
    if (!slug || slug === "") slug = "dashboard";
    return { key: `${moduleKey}.${slug}`, label: leaf.label, path: leaf.path.split("?")[0] };
  });
}

/**
 * Page-wise access catalog — every sidebar page by name.
 * Parent module key (e.g. front_office) still covers all pages under that module for legacy grants.
 */
export const PLATFORM_ACCESS_GROUPS = [
  {
    key: "workspace",
    label: "Workspace",
    pages: [
      { key: "workspace.properties", label: "Properties", path: "/properties" },
      { key: "workspace.dashboard", label: "Portfolio dashboard", path: "/properties/dashboard" },
      { key: "workspace.reports", label: "Portfolio reports", path: "/properties/reports" },
      { key: "workspace.user_management", label: "User management", path: "/properties/users" },
      { key: "workspace.roles", label: "Roles", path: "/properties/roles" },
      // In-property home (/dashboard) — listed once here to avoid a duplicate “Property dashboard” group
      { key: "dashboard", label: "Property dashboard", path: "/dashboard" },
    ],
  },
  {
    key: "front_office",
    label: "Front Office",
    pages: pages("front_office", [
      { label: "Dashboard", path: "/frontoffice/dashboard" },
      { label: "Room Availability", path: "/frontoffice/room-availability" },
      { label: "Reservations", path: "/frontoffice/reservation" },
      { label: "All Bookings", path: "/frontoffice/reservation/all-bookings" },
      { label: "Check-In", path: "/frontoffice/check-in" },
      { label: "Check-Out", path: "/frontoffice/check-out" },
      { label: "In-House Guests", path: "/frontoffice/in-house-guests" },
      { label: "Room Status", path: "/frontoffice/room-status" },
      { label: "Guest Profiles", path: "/frontoffice/guest-profiles" },
      { label: "Guest Folio", path: "/frontoffice/guest-folio" },
      { label: "Payments", path: "/frontoffice/payments" },
      { label: "Company Bills", path: "/frontoffice/company-bills" },
      { label: "Room Transfer", path: "/frontoffice/room-transfer" },
      { label: "Extend Stay", path: "/frontoffice/extend-stay" },
      { label: "Cashier · My Shift", path: "/frontoffice/cashier/session" },
      { label: "Cashier · History & Approvals", path: "/frontoffice/cashier/history" },
      { label: "Day Closing", path: "/frontoffice/day-closing" },
      { label: "Night Audit", path: "/frontoffice/night-audit" },
      { label: "Wake-up Calls", path: "/frontoffice/wake-up-calls" },
      { label: "Guest Feedback", path: "/frontoffice/guest-feedback" },
      { label: "Taxi / Cab Booking", path: "/frontoffice/taxi-booking" },
      { label: "Messages", path: "/frontoffice/messages" },
      { label: "Requisitions", path: "/frontoffice/requisitions" },
      { label: "Masters · Rooms", path: "/frontoffice/masters/rooms" },
      { label: "Masters · Room Types", path: "/frontoffice/masters/room-types" },
      { label: "Masters · Tariff Plans", path: "/frontoffice/masters/tariff-plans" },
      { label: "Masters · Companies", path: "/frontoffice/masters/companies" },
      { label: "Masters · Booking Sources", path: "/frontoffice/masters/booking-sources" },
      { label: "Masters · Staff & Shifts", path: "/frontoffice/masters/staff" },
      { label: "Reports", path: "/frontoffice/reports" },
    ]),
  },
  {
    key: "food_beverages",
    label: "Food & Beverages",
    pages: pages("food_beverages", [
      { label: "Dashboard", path: "/food-beverages/dashboard" },
      { label: "Outlets", path: "/food-beverages/restaurants/outlets" },
      { label: "Tables", path: "/food-beverages/restaurants/tables" },
      { label: "Reservations", path: "/food-beverages/restaurants/reservations" },
      { label: "Guest Order Requests", path: "/food-beverages/restaurants/guest-requests" },
      { label: "Orders", path: "/food-beverages/restaurants/orders" },
      { label: "All Orders", path: "/food-beverages/restaurants/all-orders" },
      { label: "Bills", path: "/food-beverages/restaurants/bills" },
      { label: "Kitchen", path: "/food-beverages/kitchen/orders" },
      { label: "Cashier", path: "/food-beverages/restaurants/cashier" },
      { label: "Cashier Approvals", path: "/food-beverages/restaurants/cashier/history" },
      { label: "Day Close", path: "/food-beverages/restaurants/day-close" },
      { label: "Masters · Units", path: "/food-beverages/masters/units" },
      { label: "Masters · Outlet Types", path: "/food-beverages/masters/outlet-types" },
      { label: "Masters · Staff", path: "/food-beverages/masters/staff" },
      { label: "Menu · Categories", path: "/food-beverages/menu/categories" },
      { label: "Menu · Items", path: "/food-beverages/menu/items" },
      { label: "Menu · Modifiers", path: "/food-beverages/menu/modifiers" },
      { label: "Menu · Recipes", path: "/food-beverages/menu/recipes" },
      { label: "Menu · Conversion Items", path: "/food-beverages/menu/conversion-items" },
      { label: "Inventory · Ingredients", path: "/food-beverages/inventory/ingredients" },
      { label: "Inventory · Conversion Stock", path: "/food-beverages/inventory/conversion" },
      { label: "Inventory · Wastage", path: "/food-beverages/inventory/wastage" },
      { label: "Inventory · Adjustments", path: "/food-beverages/inventory/adjustments" },
      { label: "Requisitions", path: "/food-beverages/requisitions" },
      { label: "Reports", path: "/food-beverages/reports" },
    ]),
  },
  {
    key: "housekeeping",
    label: "Housekeeping",
    pages: pages("housekeeping", [
      { label: "Dashboard", path: "/housekeeping/dashboard" },
      { label: "Room Status", path: "/housekeeping/operations/rooms" },
      { label: "Cleaning Tasks", path: "/housekeeping/operations/room-cleaning" },
      { label: "All Tasks", path: "/housekeeping/operations/all-tasks" },
      { label: "Public Area", path: "/housekeeping/operations/public-cleaning" },
      { label: "Cleaning Inspection", path: "/housekeeping/operations/inspection" },
      { label: "Guest Requests", path: "/housekeeping/housekeeping-requests" },
      { label: "Laundry Flow", path: "/housekeeping/operations/laundry" },
      { label: "Lost & Found", path: "/housekeeping/lost-and-found" },
      { label: "Damage Reports", path: "/housekeeping/operations/damage-reports" },
      { label: "Requisitions", path: "/housekeeping/operations/requisition" },
      { label: "Masters · Public Areas", path: "/housekeeping/masters/public-areas" },
      { label: "Masters · Laundry Items", path: "/housekeeping/masters/laundry-items" },
      { label: "Masters · Laundry Pricing", path: "/housekeeping/masters/laundry-pricing" },
      { label: "Masters · Staff & Shifts", path: "/housekeeping/masters/staff" },
      { label: "Reports", path: "/housekeeping/reports" },
    ]),
  },
  {
    key: "purchase_stores",
    label: "Purchase & Stores",
    pages: pages("purchase_stores", [
      { label: "Dashboard", path: "/purchase-stores/dashboard" },
      { label: "Requisitions", path: "/purchase-stores/procurement/requisitions" },
      { label: "RFQs", path: "/purchase-stores/procurement/rfq" },
      { label: "Vendors", path: "/purchase-stores/vendors" },
      { label: "Purchase Orders", path: "/purchase-stores/procurement/orders" },
      { label: "Payments", path: "/purchase-stores/procurement/payments" },
      { label: "Goods Receipt", path: "/purchase-stores/receiving/grn" },
      { label: "QC Inspection", path: "/purchase-stores/receiving/inspection" },
      { label: "Vendor Returns", path: "/purchase-stores/receiving/returns" },
      { label: "Stock", path: "/purchase-stores/inventory/stock" },
      { label: "Issues", path: "/purchase-stores/inventory/issues" },
      { label: "Transfers", path: "/purchase-stores/inventory/transfers" },
      { label: "Par Stock", path: "/purchase-stores/inventory/par-stock" },
      { label: "Adjustments", path: "/purchase-stores/inventory/adjustments" },
      { label: "Warehouses", path: "/purchase-stores/inventory/warehouses" },
      { label: "Masters · Units", path: "/purchase-stores/masters/units" },
      { label: "Masters · Categories", path: "/purchase-stores/masters/categories" },
      { label: "Masters · Products / Materials", path: "/purchase-stores/masters/products" },
      { label: "Reports", path: "/purchase-stores/reports" },
    ]),
  },
  {
    key: "human_resources",
    label: "Human Resources",
    pages: pages("human_resources", [
      { label: "Dashboard", path: "/human-resources/dashboard" },
      { label: "Employee List", path: "/human-resources/employees/list" },
      { label: "Attendance", path: "/human-resources/attendance-leave/attendance" },
      { label: "Shift Management", path: "/human-resources/attendance-leave/shift-management" },
      { label: "Leave Management", path: "/human-resources/attendance-leave/leave-management" },
      { label: "Overtime", path: "/human-resources/attendance-leave/overtime" },
      { label: "Weekly Off", path: "/human-resources/attendance-leave/weekly-off" },
      { label: "Process Payroll", path: "/human-resources/payroll/process-payroll" },
      { label: "Salary Structure", path: "/human-resources/payroll/salary-structure" },
      { label: "Payslips", path: "/human-resources/payroll/payslips" },
      { label: "Payroll Settings", path: "/human-resources/payroll/payroll-settings" },
      { label: "Raise Complaint", path: "/human-resources/grievances/raise-complaint" },
      { label: "Complaint List", path: "/human-resources/grievances/complaint-list" },
      { label: "Complaint Categories", path: "/human-resources/grievances/complaint-categories" },
      { label: "Complaint Status", path: "/human-resources/grievances/complaint-status" },
      { label: "Requisitions", path: "/human-resources/requisitions" },
      { label: "Reports", path: "/human-resources/reports" },
      { label: "Masters · Departments", path: "/human-resources/masters/departments" },
      { label: "Masters · Designations", path: "/human-resources/masters/designations" },
      { label: "Masters · Employment Types", path: "/human-resources/masters/employment-types" },
      { label: "Masters · Shift Types", path: "/human-resources/masters/shift-types" },
      { label: "Masters · Leave Types", path: "/human-resources/masters/leave-types" },
      { label: "Masters · Leave Policies", path: "/human-resources/masters/leave-policies" },
      { label: "Masters · Holiday Calendar", path: "/human-resources/masters/holiday-calendar" },
      { label: "Masters · Salary Components", path: "/human-resources/masters/salary-components" },
      { label: "Masters · Document Masters", path: "/human-resources/masters/document-masters" },
    ]),
  },
  {
    key: "accounts",
    label: "Accounts",
    pages: pages("accounts", [
      { label: "Dashboard", path: "/accounts/dashboard" },
      { label: "Property Details", path: "/accounts/masters/company-creation" },
      { label: "Company Settings", path: "/accounts/masters/company-settings" },
      { label: "Fiscal Year", path: "/accounts/masters/fiscal-year" },
      { label: "Currency", path: "/accounts/masters/currency" },
      { label: "Chart of Accounts", path: "/accounts/masters/chart-of-accounts" },
      { label: "Party Sub Type", path: "/accounts/masters/party-sub-type" },
      { label: "Party Master", path: "/accounts/masters/party-master" },
      { label: "Division", path: "/accounts/masters/division" },
      { label: "Voucher Type", path: "/accounts/masters/voucher-type" },
      { label: "Tax/GST Master", path: "/accounts/masters/tax-gst" },
      { label: "Payment Method Master", path: "/accounts/masters/payment-methods" },
      { label: "Revenue Category Master", path: "/accounts/masters/revenue-categories" },
      { label: "GL Transaction", path: "/accounts/transactions/gl-transaction" },
      { label: "GL Receipts / Payments", path: "/accounts/transactions/gl-receipts-payments" },
      { label: "Front Office Posting", path: "/accounts/transactions/front-office-posting" },
      { label: "F&B Posting", path: "/accounts/transactions/fnb-posting" },
      { label: "Provisional Transactions", path: "/accounts/transactions/provisional-transactions" },
      { label: "Bank Reconciliation", path: "/accounts/transactions/bank-reconciliation" },
      { label: "Bank Reconciliation Reversing", path: "/accounts/transactions/bank-reconciliation-reversing" },
      { label: "Closing Stock", path: "/accounts/transactions/closing-stock" },
      { label: "Fiscal Period Closing", path: "/accounts/transactions/fiscal-period-closing" },
      { label: "Fiscal Period Closing Reversing", path: "/accounts/transactions/fiscal-period-closing-reversing" },
      { label: "Reprint Voucher", path: "/accounts/transactions/reprint-voucher" },
      { label: "Outstanding Bills Aging", path: "/accounts/party-outstanding/bills-aging" },
      { label: "Outstanding Bills Aging (Custom)", path: "/accounts/party-outstanding/bills-aging-custom" },
      { label: "Outstanding Aging Summary", path: "/accounts/party-outstanding/aging-summary" },
      { label: "Outstanding Aging Summary (Custom)", path: "/accounts/party-outstanding/aging-summary-custom" },
      { label: "Party Bills & Settlement", path: "/accounts/party-outstanding/bills-and-settlement" },
      { label: "Party Bills", path: "/accounts/party-outstanding/party-bills" },
      { label: "Reminder Letter", path: "/accounts/party-outstanding/reminder-letter" },
      { label: "Balance Confirmation", path: "/accounts/party-outstanding/balance-confirmation" },
      { label: "Payment Advice", path: "/accounts/party-outstanding/payment-advice" },
      { label: "Bill Covering Letter", path: "/accounts/party-outstanding/bill-covering-letter" },
      { label: "Bill Covering Letter Reversal", path: "/accounts/party-outstanding/bill-covering-letter-reversal" },
      { label: "Bill Covering Letter Print", path: "/accounts/party-outstanding/bill-covering-letter-print" },
      { label: "Analysis", path: "/accounts/analysis" },
      { label: "Requisitions", path: "/accounts/requisitions" },
      { label: "Reports", path: "/accounts/reports" },
      { label: "Settings", path: "/accounts/settings" },
    ]),
  },
  {
    key: "sales_marketing",
    label: "Sales & Marketing",
    pages: pages("sales_marketing", [
      { label: "Dashboard", path: "/sales-marketing/dashboard" },
      { label: "Campaigns", path: "/sales-marketing/marketing/campaigns" },
      { label: "Promos & Discounts", path: "/sales-marketing/marketing/promo-codes" },
      { label: "OTA & Channel Performance", path: "/sales-marketing/marketing/ota-performance" },
      { label: "Guest Retention & Loyalty", path: "/sales-marketing/marketing/loyalty" },
      { label: "Leads & Inquiries", path: "/sales-marketing/crm/leads" },
      { label: "Deals & Pipeline", path: "/sales-marketing/crm/pipeline" },
      { label: "Activities", path: "/sales-marketing/crm/activities-calls" },
      { label: "Contacts", path: "/sales-marketing/crm/accounts-contacts" },
      { label: "Event Bookings", path: "/sales-marketing/banquets/bookings-enquiries" },
      { label: "Function Sheets (BEO)", path: "/sales-marketing/banquets/beo" },
      { label: "Venue Availability", path: "/sales-marketing/banquets/venue-availability" },
      { label: "Masters · Venues & Spaces", path: "/sales-marketing/masters/venues-spaces" },
      { label: "Masters · Lead Sources", path: "/sales-marketing/masters/lead-sources" },
      { label: "Masters · Activity Types", path: "/sales-marketing/masters/activity-types" },
      { label: "Masters · Deal Stages", path: "/sales-marketing/masters/deal-stages" },
      { label: "Masters · Booking Types", path: "/sales-marketing/masters/booking-types" },
      { label: "Masters · Contact Types", path: "/sales-marketing/masters/contact-types" },
      { label: "Requisitions", path: "/sales-marketing/requisitions" },
      { label: "Reports & Insights", path: "/sales-marketing/reports-analytics" },
      { label: "Loyalty Points Settings", path: "/sales-marketing/settings/loyalty-rules" },
    ]),
  },
  {
    key: "maintenance",
    label: "Maintenance",
    pages: pages("maintenance", [
      { label: "Dashboard", path: "/maintenance" },
      { label: "Room Status", path: "/maintenance/room-status" },
      { label: "Requests", path: "/maintenance/requests" },
      { label: "Work Orders", path: "/maintenance/work-orders" },
      { label: "Preventive Maintenance", path: "/maintenance/preventive" },
      { label: "Assets & Equipment", path: "/maintenance/assets" },
      { label: "Requisitions", path: "/maintenance/requisitions" },
      { label: "Reports", path: "/maintenance/reports" },
      { label: "Masters · Rooms", path: "/maintenance/masters/rooms" },
      { label: "Masters · Public Areas", path: "/maintenance/masters/public-areas" },
      { label: "Masters · Asset Categories", path: "/maintenance/masters/asset-categories" },
      { label: "Masters · Problem Categories", path: "/maintenance/masters/problem-categories" },
      { label: "Masters · PM Task Templates", path: "/maintenance/masters/pm-templates" },
      { label: "Masters · Vendor Master", path: "/maintenance/masters/vendors" },
    ]),
  },
] as const satisfies readonly PlatformAccessGroup[];

/** Flat list of every assignable page key (API + validation). */
export const PLATFORM_MODULES: PlatformPage[] = PLATFORM_ACCESS_GROUPS.flatMap((g) =>
  g.pages.map((p) => ({ key: p.key, label: `${g.label} · ${p.label}`, path: p.path })),
);

/** Legacy module-wide keys still accepted so old grants keep working. */
export const LEGACY_MODULE_KEYS = [
  "front_office",
  "food_beverages",
  "housekeeping",
  "purchase_stores",
  "human_resources",
  "accounts",
  "sales_marketing",
  "maintenance",
] as const;

export const PLATFORM_PAGE_KEYS = new Set([
  ...PLATFORM_MODULES.map((m) => m.key),
  ...LEGACY_MODULE_KEYS,
]);

export type ModuleKey =
  | "dashboard"
  | "front_office"
  | "food_beverages"
  | "housekeeping"
  | "purchase_stores"
  | "human_resources"
  | "accounts"
  | "sales_marketing"
  | "maintenance";

export type PropertyRow = {
  id: string;
  name: string;
  code: string;
  city: string;
  timezone: string;
  isDefault: boolean;
  status: string;
  tenantId?: string | null;
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

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Max properties this tenant may create (platform Super Admin sets). */
  propertyLimit?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type TenantUserRow = {
  tenantId: string;
  userId: string;
  role: string;
  createdAt?: string;
};

export type TenantWithAdmin = TenantRow & {
  adminUserId?: string;
  adminName?: string;
  adminEmail?: string;
  propertyCount?: number;
  userCount?: number;
};

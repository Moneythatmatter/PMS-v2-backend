export type EmployeePortalContext = {
  employeeId: string;
  empCode: string;
  propertyId: string;
  propertyName?: string;
  firstName: string;
  lastName: string;
  department?: string;
  designation?: string;
  leaveBalance?: { casual?: number; sick?: number; earned?: number };
};

export type AuthUserPublic = {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  isSuperAdmin?: boolean;
  employeeId?: string | null;
  employee?: EmployeePortalContext | null;
};

export type AuthUserRow = AuthUserPublic & {
  passwordHash: string;
  status?: string;
  authUserId?: string | null;
};

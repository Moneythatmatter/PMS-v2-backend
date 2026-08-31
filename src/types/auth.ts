export type AuthUserPublic = {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
  isSuperAdmin?: boolean;
};

export type AuthUserRow = AuthUserPublic & {
  passwordHash: string;
  status?: string;
};

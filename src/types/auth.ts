export type AuthUserPublic = {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
};

export type AuthUserRow = AuthUserPublic & {
  passwordHash: string;
  status?: string;
};

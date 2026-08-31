import type { AuthedRequest } from "../middleware/auth.js";
/** Super admin flag or legacy Admin role — platform user/property management. */
export declare function isPlatformAdmin(auth?: Pick<NonNullable<AuthedRequest["auth"]>, "isSuperAdmin" | "role"> | null): boolean;

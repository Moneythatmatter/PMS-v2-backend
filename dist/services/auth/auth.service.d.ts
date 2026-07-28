import type { AuthUserPublic } from "../../types/auth.js";
type JwtPayload = {
    sub: string;
    email: string;
    role: string;
};
export declare const AuthService: {
    login(email: string, password: string): Promise<{
        user: AuthUserPublic;
        token: string;
    }>;
    me(token: string): Promise<AuthUserPublic>;
    verifyToken(token: string): JwtPayload;
};
export {};

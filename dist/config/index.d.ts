export declare const config: {
    readonly port: number;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly supabase: {
        readonly url: () => string;
        readonly anonKey: () => string;
        /** Server-side only — bypasses RLS when set (recommended for Express API). */
        readonly serviceRoleKey: () => string | undefined;
    };
};

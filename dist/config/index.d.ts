export declare const config: {
    readonly port: number;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly supabase: {
        readonly url: () => string;
        readonly anonKey: () => string;
    };
};

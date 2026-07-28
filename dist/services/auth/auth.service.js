import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../../config/index.js";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError, NotFoundError, UnauthorizedError, ValidationError, } from "../../errors/index.js";
const USERS_TABLE = "users";
function toPublic(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        initials: user.initials,
    };
}
function signToken(user) {
    const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
    };
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpiresIn,
    });
}
async function findByEmail(email) {
    const { data, error } = await supabase
        .from(USERS_TABLE)
        .select("*")
        .eq("email", email.toLowerCase())
        .maybeSingle();
    if (error) {
        throw new AppError(`Auth database error: ${error.message}. Did you run sql/auth-users-schema.sql?`, 500, "DATABASE_ERROR");
    }
    if (!data)
        return null;
    return toCamel(data);
}
async function findById(id) {
    const { data, error } = await supabase
        .from(USERS_TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error) {
        throw new AppError(`Auth database error: ${error.message}`, 500, "DATABASE_ERROR");
    }
    if (!data)
        return null;
    return toCamel(data);
}
export const AuthService = {
    async login(email, password) {
        const normalized = email.trim().toLowerCase();
        if (!normalized || !password) {
            throw new ValidationError("Email and password are required");
        }
        const user = await findByEmail(normalized);
        if (!user) {
            throw new UnauthorizedError("Invalid email or password");
        }
        if (user.status && user.status !== "Active") {
            throw new UnauthorizedError("Account is inactive");
        }
        const okHash = await bcrypt.compare(password, user.passwordHash);
        if (!okHash) {
            throw new UnauthorizedError("Invalid email or password");
        }
        const publicUser = toPublic(user);
        const token = signToken(publicUser);
        return { user: publicUser, token };
    },
    async me(token) {
        try {
            const decoded = jwt.verify(token, config.jwtSecret);
            const user = await findById(decoded.sub);
            if (!user)
                throw new NotFoundError("User not found");
            if (user.status && user.status !== "Active") {
                throw new UnauthorizedError("Account is inactive");
            }
            return toPublic(user);
        }
        catch (e) {
            if (e instanceof AppError)
                throw e;
            throw new UnauthorizedError("Invalid or expired token");
        }
    },
    verifyToken(token) {
        try {
            return jwt.verify(token, config.jwtSecret);
        }
        catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    },
};
//# sourceMappingURL=auth.service.js.map
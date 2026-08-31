import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../../config/index.js";
import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../errors/index.js";
import type { AuthUserPublic, AuthUserRow } from "../../types/auth.js";

const USERS_TABLE = "users";

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  isSuperAdmin?: boolean;
};

function toPublic(user: AuthUserRow): AuthUserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

function signToken(user: AuthUserPublic): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

async function findByEmail(email: string): Promise<AuthUserRow | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new AppError(
      `Auth database error: ${error.message}. Did you run sql/auth-users-schema.sql?`,
      500,
      "DATABASE_ERROR",
    );
  }
  if (!data) return null;
  return toCamel<AuthUserRow>(data);
}

async function findById(id: string): Promise<AuthUserRow | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new AppError(
      `Auth database error: ${error.message}`,
      500,
      "DATABASE_ERROR",
    );
  }
  if (!data) return null;
  return toCamel<AuthUserRow>(data);
}

export const AuthService = {
  async login(email: string, password: string) {
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

  async me(token: string) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
      const user = await findById(decoded.sub);
      if (!user) throw new NotFoundError("User not found");
      if (user.status && user.status !== "Active") {
        throw new UnauthorizedError("Account is inactive");
      }
      return toPublic(user);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new UnauthorizedError("Invalid or expired token");
    }
  },

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
  },
};

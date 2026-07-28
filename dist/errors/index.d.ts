export declare class AppError extends Error {
    status: number;
    code: string;
    constructor(message: string, status?: number, code?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string);
}
export declare class ValidationError extends AppError {
    details: {
        path: string;
        message: string;
    }[];
    constructor(message?: string, details?: {
        path: string;
        message: string;
    }[]);
}
export declare class PermissionError extends AppError {
    constructor(message?: string);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string);
}
export declare class DatabaseError extends AppError {
    constructor(message?: string);
}
export declare class ConflictError extends AppError {
    constructor(message?: string);
}

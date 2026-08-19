/**
 * OpenAPI 3.0 specification for the Hotel PMS API.
 * Served at GET /api-docs (Swagger UI) and GET /api-docs.json
 */
type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type Operation = {
    tags: string[];
    summary: string;
    description?: string;
    operationId?: string;
    parameters?: unknown[];
    requestBody?: unknown;
    responses: Record<string, unknown>;
    security?: unknown[];
};
type Paths = Record<string, Partial<Record<HttpMethod, Operation>>>;
export declare const openApiDocument: {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
        contact: {
            name: string;
        };
    };
    servers: {
        url: string;
        description: string;
    }[];
    tags: {
        name: string;
        description: string;
    }[];
    components: {
        securitySchemes: {
            bearerAuth: {
                type: string;
                scheme: string;
                bearerFormat: string;
                description: string;
            };
        };
        schemas: {
            SuccessEnvelope: {
                type: string;
                properties: {
                    success: {
                        type: string;
                        example: boolean;
                    };
                    data: {};
                };
                required: string[];
            };
            ErrorEnvelope: {
                type: string;
                properties: {
                    success: {
                        type: string;
                        example: boolean;
                    };
                    error: {
                        type: string;
                    };
                    code: {
                        type: string;
                    };
                    details: {};
                };
                required: string[];
            };
        };
    };
    paths: Paths;
};
export {};

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
            HealthStatus: {
                type: string;
                properties: {
                    status: {
                        type: string;
                        example: string;
                    };
                };
                required: string[];
            };
            ApiRootInfo: {
                type: string;
                properties: {
                    message: {
                        type: string;
                        example: string;
                    };
                    version: {
                        type: string;
                        example: string;
                    };
                    docs: {
                        type: string;
                        example: string;
                    };
                    openapi: {
                        type: string;
                        example: string;
                    };
                };
            };
            LoginRequest: {
                type: string;
                required: string[];
                properties: {
                    email: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    password: {
                        type: string;
                        format: string;
                        example: string;
                    };
                };
            };
            AuthUser: {
                type: string;
                properties: {
                    id: {
                        type: string;
                        example: string;
                    };
                    name: {
                        type: string;
                        example: string;
                    };
                    email: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    role: {
                        type: string;
                        example: string;
                    };
                    initials: {
                        type: string;
                        example: string;
                    };
                    isSuperAdmin: {
                        type: string;
                        example: boolean;
                    };
                };
                required: string[];
            };
            LoginResponse: {
                type: string;
                properties: {
                    token: {
                        type: string;
                        description: string;
                        example: string;
                    };
                    user: {
                        $ref: string;
                    };
                };
                required: string[];
            };
            Property: {
                type: string;
                properties: {
                    id: {
                        type: string;
                        example: string;
                    };
                    name: {
                        type: string;
                        example: string;
                    };
                    code: {
                        type: string;
                        example: string;
                    };
                    city: {
                        type: string;
                        example: string;
                    };
                    timezone: {
                        type: string;
                        example: string;
                    };
                    isDefault: {
                        type: string;
                        example: boolean;
                    };
                    status: {
                        type: string;
                        enum: string[];
                        example: string;
                    };
                };
                required: string[];
            };
            CreatePropertyRequest: {
                type: string;
                required: string[];
                properties: {
                    name: {
                        type: string;
                        example: string;
                    };
                    code: {
                        type: string;
                        example: string;
                    };
                    city: {
                        type: string;
                        example: string;
                    };
                    timezone: {
                        type: string;
                        example: string;
                    };
                    isDefault: {
                        type: string;
                        default: boolean;
                    };
                };
            };
            UpdatePropertyRequest: {
                type: string;
                properties: {
                    name: {
                        type: string;
                    };
                    code: {
                        type: string;
                    };
                    city: {
                        type: string;
                    };
                    timezone: {
                        type: string;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                };
            };
            PlatformModule: {
                type: string;
                properties: {
                    key: {
                        type: string;
                        example: string;
                        enum: string[];
                    };
                    label: {
                        type: string;
                        example: string;
                    };
                };
                required: string[];
            };
            PermissionLevel: {
                type: string;
                enum: string[];
                example: string;
            };
            UserPermission: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    userId: {
                        type: string;
                    };
                    propertyId: {
                        type: string;
                    };
                    moduleKey: {
                        type: string;
                        example: string;
                    };
                    permission: {
                        $ref: string;
                    };
                };
                required: string[];
            };
            PermissionAssignment: {
                type: string;
                required: string[];
                properties: {
                    propertyId: {
                        type: string;
                        example: string;
                    };
                    moduleKey: {
                        type: string;
                        example: string;
                    };
                    permission: {
                        $ref: string;
                    };
                };
            };
            MyPermissionsMap: {
                type: string;
                additionalProperties: {
                    $ref: string;
                };
                example: {
                    dashboard: string;
                    front_office: string;
                    housekeeping: string;
                };
            };
            ManagedUser: {
                type: string;
                allOf: ({
                    $ref: string;
                    type?: undefined;
                    properties?: undefined;
                    required?: undefined;
                } | {
                    type: string;
                    properties: {
                        status: {
                            type: string;
                            example: string;
                        };
                        propertyIds: {
                            type: string;
                            items: {
                                type: string;
                            };
                            example: string[];
                        };
                        permissions: {
                            type: string;
                            items: {
                                $ref: string;
                            };
                        };
                    };
                    required: string[];
                    $ref?: undefined;
                })[];
            };
            CreateUserRequest: {
                type: string;
                required: string[];
                properties: {
                    name: {
                        type: string;
                        example: string;
                    };
                    email: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    password: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    role: {
                        type: string;
                        example: string;
                    };
                    initials: {
                        type: string;
                        example: string;
                    };
                    isSuperAdmin: {
                        type: string;
                        default: boolean;
                    };
                    propertyIds: {
                        type: string;
                        items: {
                            type: string;
                        };
                        example: string[];
                    };
                    permissions: {
                        type: string;
                        items: {
                            $ref: string;
                        };
                    };
                };
            };
            UpdateUserRequest: {
                type: string;
                properties: {
                    name: {
                        type: string;
                    };
                    role: {
                        type: string;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    isSuperAdmin: {
                        type: string;
                    };
                    propertyIds: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    permissions: {
                        type: string;
                        items: {
                            $ref: string;
                        };
                    };
                };
            };
            FoRoom: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    roomNo: {
                        type: string;
                        example: string;
                    };
                    type: {
                        type: string;
                        example: string;
                    };
                    floor: {
                        type: string;
                        example: string;
                    };
                    bedType: {
                        type: string;
                        example: string;
                    };
                    maxOccupancy: {
                        type: string;
                        example: number;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    housekeeping: {
                        type: string;
                    };
                    maintenance: {
                        type: string;
                    };
                };
            };
            FoRoomStatusCard: {
                type: string;
                properties: {
                    roomNo: {
                        type: string;
                        example: string;
                    };
                    type: {
                        type: string;
                        example: string;
                    };
                    floor: {
                        type: string;
                        example: string;
                    };
                    status: {
                        type: string;
                        example: string;
                    };
                    guestName: {
                        type: string;
                        nullable: boolean;
                    };
                    checkoutDate: {
                        type: string;
                        nullable: boolean;
                    };
                    maintenance: {
                        type: string;
                        example: string;
                    };
                };
            };
            FoReservation: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    bookingNo: {
                        type: string;
                        example: string;
                    };
                    guestName: {
                        type: string;
                        example: string;
                    };
                    phone: {
                        type: string;
                    };
                    roomType: {
                        type: string;
                        example: string;
                    };
                    checkIn: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    checkOut: {
                        type: string;
                        format: string;
                        example: string;
                    };
                    status: {
                        type: string;
                        enum: string[];
                    };
                    roomNo: {
                        type: string;
                        nullable: boolean;
                    };
                    amount: {
                        type: string;
                    };
                };
            };
        };
    };
    paths: Paths;
};
export {};

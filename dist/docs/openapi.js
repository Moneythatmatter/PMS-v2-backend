/**
 * OpenAPI 3.0 specification for the Hotel PMS API.
 * Served at GET /api-docs (Swagger UI) and GET /api-docs.json
 */
const successSchema = {
    type: "object",
    properties: {
        success: { type: "boolean", example: true },
        data: {},
    },
    required: ["success", "data"],
};
const errorSchema = {
    type: "object",
    properties: {
        success: { type: "boolean", example: false },
        error: { type: "string" },
        code: { type: "string" },
        details: {},
    },
    required: ["success", "error"],
};
function okResponse(description = "Successful response", schema = successSchema) {
    return {
        description,
        content: { "application/json": { schema } },
    };
}
function errorResponses() {
    return {
        "400": {
            description: "Bad request / validation error",
            content: { "application/json": { schema: errorSchema } },
        },
        "401": {
            description: "Unauthorized",
            content: { "application/json": { schema: errorSchema } },
        },
        "404": {
            description: "Not found",
            content: { "application/json": { schema: errorSchema } },
        },
        "500": {
            description: "Server error",
            content: { "application/json": { schema: errorSchema } },
        },
    };
}
function jsonBody(description = "Request body", example) {
    return {
        required: true,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    additionalProperties: true,
                    ...(example ? { example } : {}),
                },
            },
        },
        description,
    };
}
function idParam(name = "id", description = "Resource ID") {
    return {
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
        description,
    };
}
function queryParam(name, description, example) {
    return {
        name,
        in: "query",
        required: false,
        schema: { type: "string", ...(example ? { example } : {}) },
        description,
    };
}
/** Standard list / get / create / update / delete for a resource */
function crudPaths(basePath, tag, resource, opts) {
    const id = opts?.idPrefix ? `${opts.idPrefix}-001` : "example-id";
    const listParams = opts?.listQuery ?? [];
    return {
        [basePath]: {
            get: {
                tags: [tag],
                summary: `List ${resource}`,
                description: `Returns all ${resource} records.`,
                parameters: listParams,
                responses: {
                    "200": okResponse(`List of ${resource}`),
                    ...errorResponses(),
                },
            },
            post: {
                tags: [tag],
                summary: `Create ${resource.slice(0, -1)}`,
                description: `Creates a new ${resource.slice(0, -1)}.`,
                requestBody: jsonBody(`New ${resource.slice(0, -1)}`, opts?.createExample),
                responses: {
                    "200": okResponse(`Created ${resource.slice(0, -1)}`),
                    "201": okResponse(`Created ${resource.slice(0, -1)}`),
                    ...errorResponses(),
                },
            },
        },
        [`${basePath}/{id}`]: {
            get: {
                tags: [tag],
                summary: `Get ${resource.slice(0, -1)}`,
                parameters: [idParam("id", `${resource.slice(0, -1)} ID (e.g. ${id})`)],
                responses: {
                    "200": okResponse(`Single ${resource.slice(0, -1)}`),
                    ...errorResponses(),
                },
            },
            put: {
                tags: [tag],
                summary: `Replace ${resource.slice(0, -1)}`,
                parameters: [idParam()],
                requestBody: jsonBody(),
                responses: {
                    "200": okResponse(`Updated ${resource.slice(0, -1)}`),
                    ...errorResponses(),
                },
            },
            patch: {
                tags: [tag],
                summary: `Update ${resource.slice(0, -1)}`,
                parameters: [idParam()],
                requestBody: jsonBody(),
                responses: {
                    "200": okResponse(`Updated ${resource.slice(0, -1)}`),
                    ...errorResponses(),
                },
            },
            delete: {
                tags: [tag],
                summary: `Delete ${resource.slice(0, -1)}`,
                parameters: [idParam()],
                responses: {
                    "200": okResponse(`Deleted ${resource.slice(0, -1)}`),
                    ...errorResponses(),
                },
            },
        },
    };
}
function mergePaths(...parts) {
    const out = {};
    for (const part of parts) {
        for (const [path, methods] of Object.entries(part)) {
            out[path] = { ...(out[path] ?? {}), ...methods };
        }
    }
    return out;
}
function actionPath(path, tag, summary, method = "post", opts) {
    return {
        [path]: {
            [method]: {
                tags: [tag],
                summary,
                description: opts?.description,
                parameters: path.includes("{id}") ? [idParam()] : undefined,
                ...(opts?.body ? { requestBody: jsonBody() } : {}),
                responses: {
                    "200": okResponse(),
                    ...errorResponses(),
                },
            },
        },
    };
}
const TAGS = [
    { name: "System", description: "Health and API metadata" },
    { name: "Auth", description: "Authentication and current user" },
    { name: "FO · Dashboard", description: "Front Office dashboard overview" },
    { name: "FO · Reservations", description: "Bookings, check-in, check-out, extend stay" },
    { name: "FO · Rooms", description: "Room inventory, availability, and status cards" },
    { name: "FO · Masters", description: "Room types, tariff plans, market segments, companies, booking sources" },
    { name: "FO · Guests", description: "Guest profiles and stay history" },
    { name: "FO · Billing", description: "Folio, payments, and invoices" },
    { name: "FO · Guest Services", description: "Transfers, wake-ups, taxi, luggage, messages, feedback, HK & maintenance requests, lost & found" },
    { name: "FO · Closing", description: "Cashier shifts, room charge postings, day closing" },
    { name: "FO · Reports", description: "Front Office operational reports" },
    { name: "FB · Dashboard", description: "Food & Beverages dashboard" },
    { name: "FB · Live Tables", description: "Floor map: seat, settle, clean" },
    { name: "FB · Orders", description: "Restaurant / cafe / bar orders" },
    { name: "FB · Kitchen (KDS)", description: "Kitchen display tickets" },
    { name: "FB · Cashier", description: "Cashier shifts open / close" },
    { name: "FB · Outlets", description: "Outlet masters" },
    { name: "FB · Tables Master", description: "Table configuration CRUD" },
    { name: "FB · Reservations", description: "F&B table reservations" },
    { name: "FB · Masters", description: "Units, tax groups, modifier groups, outlet types" },
    { name: "FB · Menu", description: "Categories, items, modifiers, recipes" },
    { name: "FB · Inventory", description: "Ingredients, wastage, adjustments" },
    { name: "FB · Reports", description: "F&B sales and kitchen reports" },
    { name: "HK · Dashboard", description: "Housekeeping dashboard" },
    { name: "HK · Rooms", description: "Room cleaning workflow and status" },
    { name: "HK · Laundry", description: "Laundry jobs and status advance" },
    { name: "HK · Requisitions", description: "Supply requisitions approve / issue / reject" },
    { name: "HK · Public Areas", description: "Lobby / corridor cleaning areas" },
    { name: "HK · Checklists", description: "Checklist templates" },
    { name: "HK · Staff & Shifts", description: "Housekeeping staff and shift roster" },
    { name: "HK · Inventory", description: "HK store inventory and par levels" },
    { name: "HK · Damage & History", description: "Damage reports and activity history" },
    { name: "HK · Guest Services", description: "Luggage, guest requests, maintenance, lost & found, settings" },
    { name: "HK · Reports", description: "Housekeeping productivity and status reports" },
];
const systemPaths = {
    "/": {
        get: {
            tags: ["System"],
            summary: "API root",
            responses: { "200": okResponse("API is running") },
        },
    },
    "/health": {
        get: {
            tags: ["System"],
            summary: "Health check",
            responses: {
                "200": okResponse("Service healthy", {
                    type: "object",
                    properties: { status: { type: "string", example: "ok" } },
                }),
            },
        },
    },
};
const authPaths = {
    "/api/auth/login": {
        post: {
            tags: ["Auth"],
            summary: "Login",
            description: "Authenticate with email and password. Returns JWT and user profile.",
            requestBody: jsonBody("Credentials", {
                email: "admin@hotel.com",
                password: "password",
            }),
            responses: {
                "200": okResponse("Login success — token + user"),
                ...errorResponses(),
            },
        },
    },
    "/api/auth/me": {
        get: {
            tags: ["Auth"],
            summary: "Current user",
            description: "Returns the authenticated user from Bearer token.",
            security: [{ bearerAuth: [] }],
            responses: {
                "200": okResponse("Current user"),
                ...errorResponses(),
            },
        },
    },
};
const foBase = "/api/front-office";
const foPaths = mergePaths({
    [`${foBase}/dashboard`]: {
        get: {
            tags: ["FO · Dashboard"],
            summary: "Front Office dashboard",
            description: "Stats, arrivals, departures, room inventory, weekly flow, booking sources, desk activity.",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, 
// Reservations
{
    [`${foBase}/reservations`]: {
        get: {
            tags: ["FO · Reservations"],
            summary: "List reservations",
            parameters: [queryParam("status", "Filter by status", "Checked In")],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["FO · Reservations"],
            summary: "Create reservation",
            requestBody: jsonBody("Reservation payload", {
                guestName: "Rahul Sharma",
                phone: "+91 98765 43210",
                roomType: "Deluxe",
                checkIn: "2026-08-05",
                checkOut: "2026-08-08",
                status: "Reserved",
            }),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${foBase}/reservations/summary`]: {
        get: {
            tags: ["FO · Reservations"],
            summary: "Reservation summary cards",
            responses: { "200": okResponse("Total / Arriving Today / In-House / Outstanding"), ...errorResponses() },
        },
    },
    [`${foBase}/reservations/in-house`]: {
        get: {
            tags: ["FO · Reservations"],
            summary: "List in-house guests",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${foBase}/reservations/{id}`]: {
        get: {
            tags: ["FO · Reservations"],
            summary: "Get reservation",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["FO · Reservations"],
            summary: "Replace reservation",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["FO · Reservations"],
            summary: "Update reservation",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        delete: {
            tags: ["FO · Reservations"],
            summary: "Delete reservation",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${foBase}/reservations/{id}/check-in`, "FO · Reservations", "Check in guest", "post", {
    body: true,
    description: "Marks reservation as Checked In and occupies the room.",
}), actionPath(`${foBase}/reservations/{id}/check-out`, "FO · Reservations", "Check out guest", "post", {
    body: true,
    description: "Settles folio and vacates the room.",
}), actionPath(`${foBase}/reservations/{id}/extend-stay`, "FO · Reservations", "Extend stay", "post", {
    body: true,
    description: "Updates check-out date / nights / amounts.",
}), 
// Rooms
{
    [`${foBase}/rooms`]: {
        get: {
            tags: ["FO · Rooms"],
            summary: "List rooms",
            parameters: [queryParam("status", "Filter by status", "Vacant")],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["FO · Rooms"],
            summary: "Create room",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${foBase}/rooms/availability`]: {
        get: {
            tags: ["FO · Rooms"],
            summary: "Room availability grid",
            parameters: [queryParam("start", "Start date (ISO)", "2026-08-05")],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${foBase}/rooms/status`]: {
        get: {
            tags: ["FO · Rooms"],
            summary: "Room status cards",
            description: "Card view used by Room Status and check-in room picker.",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${foBase}/rooms/{id}`]: {
        get: {
            tags: ["FO · Rooms"],
            summary: "Get room",
            parameters: [idParam("id", "Room number")],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["FO · Rooms"],
            summary: "Replace room",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["FO · Rooms"],
            summary: "Update room",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, 
// Masters
crudPaths(`${foBase}/masters/room-types`, "FO · Masters", "room types", { idPrefix: "RT" }), crudPaths(`${foBase}/masters/tariff-plans`, "FO · Masters", "tariff plans", { idPrefix: "TP" }), crudPaths(`${foBase}/masters/market-segments`, "FO · Masters", "market segments", { idPrefix: "MS" }), crudPaths(`${foBase}/masters/companies`, "FO · Masters", "companies", { idPrefix: "CO" }), crudPaths(`${foBase}/masters/booking-sources`, "FO · Masters", "booking sources", { idPrefix: "BS" }), 
// Guests
crudPaths(`${foBase}/guests`, "FO · Guests", "guests", { idPrefix: "G" }), crudPaths(`${foBase}/guest-stay-history`, "FO · Guests", "stay history records", {
    idPrefix: "SH",
    listQuery: [queryParam("guestId", "Filter by guest ID")],
}), 
// Billing
crudPaths(`${foBase}/folio`, "FO · Billing", "folio entries", {
    idPrefix: "FE",
    listQuery: [
        queryParam("room", "Filter by room"),
        queryParam("reservationId", "Filter by reservation"),
    ],
}), crudPaths(`${foBase}/payments`, "FO · Billing", "payments", { idPrefix: "PAY" }), crudPaths(`${foBase}/invoices`, "FO · Billing", "invoices", { idPrefix: "INV" }), 
// Guest services
crudPaths(`${foBase}/transfers`, "FO · Guest Services", "room transfers", { idPrefix: "TR" }), crudPaths(`${foBase}/wake-up-calls`, "FO · Guest Services", "wake-up calls", { idPrefix: "WU" }), crudPaths(`${foBase}/taxi-bookings`, "FO · Guest Services", "taxi bookings", { idPrefix: "TX" }), crudPaths(`${foBase}/luggage`, "FO · Guest Services", "luggage items", { idPrefix: "LG" }), crudPaths(`${foBase}/messages`, "FO · Guest Services", "messages", { idPrefix: "MSG" }), crudPaths(`${foBase}/feedback`, "FO · Guest Services", "feedback entries", { idPrefix: "FB" }), crudPaths(`${foBase}/lost-found`, "FO · Guest Services", "lost & found items", { idPrefix: "LF" }), crudPaths(`${foBase}/housekeeping-requests`, "FO · Guest Services", "housekeeping requests", {
    idPrefix: "HK",
}), crudPaths(`${foBase}/maintenance-requests`, "FO · Guest Services", "maintenance requests", {
    idPrefix: "MT",
}), 
// Closing
crudPaths(`${foBase}/cashier-shifts`, "FO · Closing", "cashier shifts", { idPrefix: "CS" }), crudPaths(`${foBase}/room-charge-postings`, "FO · Closing", "room charge postings", {
    idPrefix: "RCP",
}), crudPaths(`${foBase}/day-closing`, "FO · Closing", "day closings", { idPrefix: "DC" }), 
// Reports
{
    [`${foBase}/reports/{type}`]: {
        get: {
            tags: ["FO · Reports"],
            summary: "Front Office report",
            description: "Report types: `arrival`, `departure`, `occupancy`, `revenue`, `cashier`, `night-audit`, `guest`, `room`, `tax`.",
            parameters: [
                {
                    name: "type",
                    in: "path",
                    required: true,
                    schema: {
                        type: "string",
                        enum: [
                            "arrival",
                            "departure",
                            "occupancy",
                            "revenue",
                            "cashier",
                            "night-audit",
                            "guest",
                            "room",
                            "tax",
                        ],
                    },
                },
            ],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
});
const fbBase = "/api/food-beverages";
const outletQ = queryParam("outletId", "Filter by outlet ID");
const fbPaths = mergePaths({
    [`${fbBase}/dashboard`]: {
        get: {
            tags: ["FB · Dashboard"],
            summary: "F&B dashboard",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${fbBase}/live-tables`]: {
        get: {
            tags: ["FB · Live Tables"],
            summary: "List live tables",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${fbBase}/live-tables/{id}`]: {
        patch: {
            tags: ["FB · Live Tables"],
            summary: "Update live table",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["FB · Live Tables"],
            summary: "Replace live table",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${fbBase}/live-tables/{id}/seat`, "FB · Live Tables", "Seat guests at table"), actionPath(`${fbBase}/live-tables/{id}/settle`, "FB · Live Tables", "Settle table bill"), actionPath(`${fbBase}/live-tables/{id}/clean`, "FB · Live Tables", "Mark table cleaned"), crudPaths(`${fbBase}/tables`, "FB · Tables Master", "tables", {
    idPrefix: "T",
    listQuery: [outletQ],
}), {
    [`${fbBase}/orders`]: {
        get: {
            tags: ["FB · Orders"],
            summary: "List orders",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["FB · Orders"],
            summary: "Create order",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${fbBase}/orders/{id}`]: {
        get: {
            tags: ["FB · Orders"],
            summary: "Get order",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["FB · Orders"],
            summary: "Replace order",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["FB · Orders"],
            summary: "Update order",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        delete: {
            tags: ["FB · Orders"],
            summary: "Delete order",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${fbBase}/orders/{id}/advance`, "FB · Orders", "Advance order status"), {
    [`${fbBase}/kds`]: {
        get: {
            tags: ["FB · Kitchen (KDS)"],
            summary: "List KDS tickets",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["FB · Kitchen (KDS)"],
            summary: "Create KDS ticket",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${fbBase}/kds/{id}`]: {
        put: {
            tags: ["FB · Kitchen (KDS)"],
            summary: "Replace KDS ticket",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["FB · Kitchen (KDS)"],
            summary: "Update KDS ticket",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${fbBase}/kds/{id}/advance`, "FB · Kitchen (KDS)", "Advance KDS ticket"), crudPaths(`${fbBase}/kds-tickets`, "FB · Kitchen (KDS)", "KDS tickets", {
    idPrefix: "K",
    listQuery: [outletQ],
}), {
    [`${fbBase}/cashier-shifts`]: {
        get: {
            tags: ["FB · Cashier"],
            summary: "List cashier shifts",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["FB · Cashier"],
            summary: "Open cashier shift",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${fbBase}/cashier-shifts/{id}`]: {
        patch: {
            tags: ["FB · Cashier"],
            summary: "Update cashier shift",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["FB · Cashier"],
            summary: "Replace cashier shift",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${fbBase}/cashier-shifts/{id}/close`, "FB · Cashier", "Close cashier shift", "post", {
    body: true,
}), crudPaths(`${fbBase}/outlets`, "FB · Outlets", "outlets", { idPrefix: "OUT" }), crudPaths(`${fbBase}/reservations`, "FB · Reservations", "F&B reservations", {
    idPrefix: "RES",
    listQuery: [outletQ],
}), crudPaths(`${fbBase}/menu/categories`, "FB · Menu", "menu categories", { idPrefix: "uuid" }), crudPaths(`${fbBase}/masters/units`, "FB · Masters", "units of measure", { idPrefix: "UN" }), crudPaths(`${fbBase}/masters/tax-groups`, "FB · Masters", "tax groups", { idPrefix: "TG" }), crudPaths(`${fbBase}/masters/modifier-groups`, "FB · Masters", "modifier groups", {
    idPrefix: "MGR",
}), crudPaths(`${fbBase}/masters/outlet-types`, "FB · Masters", "outlet types", { idPrefix: "OFT" }), crudPaths(`${fbBase}/menu/items`, "FB · Menu", "menu items", { idPrefix: "uuid" }), crudPaths(`${fbBase}/menu/modifiers`, "FB · Menu", "modifiers", { idPrefix: "MOD" }), crudPaths(`${fbBase}/menu/recipes`, "FB · Menu", "recipes", { idPrefix: "RC" }), crudPaths(`${fbBase}/inventory/ingredients`, "FB · Inventory", "ingredients", { idPrefix: "ING" }), crudPaths(`${fbBase}/inventory/wastage`, "FB · Inventory", "wastage records", { idPrefix: "WST" }), crudPaths(`${fbBase}/inventory/adjustments`, "FB · Inventory", "stock adjustments", {
    idPrefix: "ADJ",
}), crudPaths(`${fbBase}/day-close`, "FB · Restaurants", "day close records", {
    idPrefix: "DC",
    listQuery: [outletQ],
}), {
    [`${fbBase}/reports/{type}`]: {
        get: {
            tags: ["FB · Reports"],
            summary: "F&B report",
            description: "Types: `daily-sales`, `item-sales`, `category-sales`, `outlet-sales`, `cashier`, `table-turnover`, `food-cost`, `inventory`, `kitchen-performance`, `cancelled-bills`, `discount`.",
            parameters: [
                {
                    name: "type",
                    in: "path",
                    required: true,
                    schema: {
                        type: "string",
                        enum: [
                            "daily-sales",
                            "item-sales",
                            "category-sales",
                            "outlet-sales",
                            "cashier",
                            "table-turnover",
                            "food-cost",
                            "inventory",
                            "kitchen-performance",
                            "cancelled-bills",
                            "discount",
                        ],
                    },
                },
            ],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
});
const hkBase = "/api/housekeeping";
const hkPaths = mergePaths({
    [`${hkBase}/dashboard`]: {
        get: {
            tags: ["HK · Dashboard"],
            summary: "Housekeeping dashboard",
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${hkBase}/rooms`]: {
        get: {
            tags: ["HK · Rooms"],
            summary: "List HK rooms",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["HK · Rooms"],
            summary: "Create HK room",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${hkBase}/rooms/{id}`]: {
        get: {
            tags: ["HK · Rooms"],
            summary: "Get HK room",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["HK · Rooms"],
            summary: "Replace HK room",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["HK · Rooms"],
            summary: "Update HK room",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        delete: {
            tags: ["HK · Rooms"],
            summary: "Delete HK room",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${hkBase}/rooms/{id}/start-clean`, "HK · Rooms", "Start cleaning"), actionPath(`${hkBase}/rooms/{id}/pause-clean`, "HK · Rooms", "Pause cleaning"), actionPath(`${hkBase}/rooms/{id}/complete-clean`, "HK · Rooms", "Complete cleaning"), actionPath(`${hkBase}/rooms/{id}/inspect`, "HK · Rooms", "Inspect room", "post", { body: true }), actionPath(`${hkBase}/rooms/{id}/mark-dirty`, "HK · Rooms", "Mark room dirty"), {
    [`${hkBase}/laundry`]: {
        get: {
            tags: ["HK · Laundry"],
            summary: "List laundry jobs",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["HK · Laundry"],
            summary: "Create laundry job",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${hkBase}/laundry/{id}`]: {
        get: {
            tags: ["HK · Laundry"],
            summary: "Get laundry job",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["HK · Laundry"],
            summary: "Replace laundry job",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["HK · Laundry"],
            summary: "Update laundry job",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        delete: {
            tags: ["HK · Laundry"],
            summary: "Delete laundry job",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${hkBase}/laundry/{id}/advance`, "HK · Laundry", "Advance laundry status"), {
    [`${hkBase}/requisitions`]: {
        get: {
            tags: ["HK · Requisitions"],
            summary: "List requisitions",
            responses: { "200": okResponse(), ...errorResponses() },
        },
        post: {
            tags: ["HK · Requisitions"],
            summary: "Create requisition",
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
    [`${hkBase}/requisitions/{id}`]: {
        get: {
            tags: ["HK · Requisitions"],
            summary: "Get requisition",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
        put: {
            tags: ["HK · Requisitions"],
            summary: "Replace requisition",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        patch: {
            tags: ["HK · Requisitions"],
            summary: "Update requisition",
            parameters: [idParam()],
            requestBody: jsonBody(),
            responses: { "200": okResponse(), ...errorResponses() },
        },
        delete: {
            tags: ["HK · Requisitions"],
            summary: "Delete requisition",
            parameters: [idParam()],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
}, actionPath(`${hkBase}/requisitions/{id}/approve`, "HK · Requisitions", "Approve requisition"), actionPath(`${hkBase}/requisitions/{id}/issue`, "HK · Requisitions", "Issue requisition"), actionPath(`${hkBase}/requisitions/{id}/reject`, "HK · Requisitions", "Reject requisition", "post", {
    body: true,
}), crudPaths(`${hkBase}/public-areas`, "HK · Public Areas", "public areas", {
    idPrefix: "PA",
    listQuery: [
        queryParam("status", "Filter by status"),
        queryParam("category", "Filter by category"),
        queryParam("floor", "Filter by floor"),
    ],
}), crudPaths(`${hkBase}/checklists`, "HK · Checklists", "checklist templates", { idPrefix: "CL" }), crudPaths(`${hkBase}/staff`, "HK · Staff & Shifts", "staff members", {
    idPrefix: "ST",
    listQuery: [
        queryParam("role", "Filter by role"),
        queryParam("status", "Filter by status"),
    ],
}), crudPaths(`${hkBase}/shifts`, "HK · Staff & Shifts", "shifts", { idPrefix: "SH" }), crudPaths(`${hkBase}/inventory`, "HK · Inventory", "inventory items", {
    idPrefix: "INV",
    listQuery: [queryParam("category", "Filter by category")],
}), crudPaths(`${hkBase}/damage-reports`, "HK · Damage & History", "damage reports", {
    idPrefix: "DM",
    listQuery: [
        queryParam("status", "Filter by status"),
        queryParam("room", "Filter by room"),
    ],
}), crudPaths(`${hkBase}/history`, "HK · Damage & History", "history entries", {
    idPrefix: "H",
    listQuery: [
        queryParam("category", "Filter by category"),
        queryParam("room", "Filter by room"),
    ],
}), crudPaths(`${hkBase}/luggage`, "HK · Guest Services", "luggage jobs", {
    idPrefix: "LG",
    listQuery: [
        queryParam("status", "Filter by status"),
        queryParam("type", "Filter by type"),
    ],
}), crudPaths(`${hkBase}/settings`, "HK · Guest Services", "settings", { idPrefix: "SET" }), crudPaths(`${hkBase}/guest-requests`, "HK · Guest Services", "guest requests", {
    idPrefix: "HKR",
    listQuery: [
        queryParam("status", "Filter by status"),
        queryParam("room", "Filter by room"),
    ],
}), crudPaths(`${hkBase}/maintenance`, "HK · Guest Services", "maintenance tickets", {
    idPrefix: "MNT",
    listQuery: [
        queryParam("status", "Filter by status"),
        queryParam("room", "Filter by room"),
    ],
}), crudPaths(`${hkBase}/lost-found`, "HK · Guest Services", "lost & found items", {
    idPrefix: "LF",
    listQuery: [queryParam("status", "Filter by status")],
}), {
    [`${hkBase}/reports/{type}`]: {
        get: {
            tags: ["HK · Reports"],
            summary: "Housekeeping report",
            description: "Types: `room-status`, `cleaning-productivity`, `inspection`, `laundry`, `inventory`, `damage`, `staff-performance`, `public-area`.",
            parameters: [
                {
                    name: "type",
                    in: "path",
                    required: true,
                    schema: {
                        type: "string",
                        enum: [
                            "room-status",
                            "cleaning-productivity",
                            "inspection",
                            "laundry",
                            "inventory",
                            "damage",
                            "staff-performance",
                            "public-area",
                        ],
                    },
                },
            ],
            responses: { "200": okResponse(), ...errorResponses() },
        },
    },
});
export const openApiDocument = {
    openapi: "3.0.3",
    info: {
        title: "Hotel PMS API",
        version: "1.0.0",
        description: [
            "REST API for **IMPACT PMS** — Front Office, Food & Beverages, Housekeeping, and Auth.",
            "",
            "### Modules",
            "| Prefix | Module |",
            "|--------|--------|",
            "| `/api/auth` | Authentication |",
            "| `/api/front-office` | Front Office (FO) |",
            "| `/api/food-beverages` | Food & Beverages (FB) |",
            "| `/api/housekeeping` | Housekeeping (HK) |",
            "",
            "### Response envelope",
            "Success: `{ success: true, data: ... }`",
            "Error: `{ success: false, error: string, code?: string, details?: ... }`",
            "",
            "Most list resources support standard CRUD: `GET`, `POST`, `GET /:id`, `PUT|PATCH /:id`, `DELETE /:id`.",
        ].join("\n"),
        contact: { name: "PMS Backend" },
    },
    servers: [
        { url: "http://localhost:5001", description: "Local development" },
        { url: "/", description: "Current host" },
    ],
    tags: TAGS,
    components: {
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "JWT from `POST /api/auth/login`",
            },
        },
        schemas: {
            SuccessEnvelope: successSchema,
            ErrorEnvelope: errorSchema,
        },
    },
    paths: mergePaths(systemPaths, authPaths, foPaths, fbPaths, hkPaths),
};
//# sourceMappingURL=openapi.js.map
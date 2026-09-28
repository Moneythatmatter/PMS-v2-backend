import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { AppError } from "../../errors/index.js";
import { fetchRoomsByRefs, lookupRoomInMap, resolveRoomId, } from "./room-resolver.js";
import { defaultWalkInSourceId, fetchBookingSourcesByIds, resolveSourceId, } from "./source-resolver.js";
/** Placeholders like TBA must never touch the rooms table. */
export function isRealRoomRef(roomRef) {
    const value = String(roomRef ?? "").trim();
    if (!value)
        return false;
    return !/^(tba|n\/?a|unassigned|-)$/i.test(value);
}
/** Prefer human room number for UI (never expose rooms.id). */
export function displayRoomNo(row) {
    return String(row.roomNo ?? "").trim();
}
/** Resolve room ref from API payload (roomRefId or legacy roomNo). */
export function resolveRoomRef(input) {
    const ref = String(input.roomRefId ?? input.roomNo ?? "").trim();
    return ref || null;
}
const GUEST_ONLY_FIELDS = [
    "guestNo",
    "guestName",
    "phone",
    "email",
    "nationality",
    "gender",
    "dob",
    "address",
    "city",
    "state",
    "country",
    "pincode",
    "idProofType",
    "idNumber",
];
const ROOM_ONLY_FIELDS = ["roomNo", "roomType"];
/** Resolve source ref from API payload (sourceId or legacy source name). */
export function resolveSourceRef(input) {
    const ref = String(input.sourceId ?? input.source ?? "").trim();
    return ref || null;
}
/** Strip denormalized guest/room/source fields before DB write. */
export function sanitizeReservationInput(input) {
    const body = { ...input };
    const roomRef = resolveRoomRef(input);
    if (roomRef)
        body.roomRefId = roomRef;
    delete body.roomNo;
    const sourceRef = resolveSourceRef(input);
    if (sourceRef)
        body.sourceId = sourceRef;
    for (const key of GUEST_ONLY_FIELDS)
        delete body[key];
    for (const key of ROOM_ONLY_FIELDS)
        delete body[key];
    delete body.source;
    delete body.bookingNo;
    delete body.guestNo;
    delete body.paymentReference;
    delete body.externalReference;
    return body;
}
/** Resolve room number / UUID from API to rooms.id for FK storage. */
export async function normalizeReservationRoomRef(body) {
    if (body.roomRefId == null || body.roomRefId === "")
        return;
    const raw = String(body.roomRefId).trim();
    const resolved = await resolveRoomId(raw);
    if (resolved) {
        body.roomRefId = resolved;
        return;
    }
    throw new AppError(`Room "${raw}" was not found for this property.`);
}
/** Resolve source name / code / UUID from API to booking_sources.id for FK storage. */
export async function normalizeReservationSourceRef(body) {
    if (body.sourceId == null || body.sourceId === "") {
        const fallback = await defaultWalkInSourceId();
        if (fallback)
            body.sourceId = fallback;
        return;
    }
    const resolved = await resolveSourceId(String(body.sourceId));
    if (resolved)
        body.sourceId = resolved;
    else
        delete body.sourceId;
}
function applyGuestFields(row, guest) {
    if (!guest) {
        if (!row.guestId) {
            return {
                ...row,
                guestName: row.guestName || undefined,
            };
        }
        return row;
    }
    return {
        ...row,
        guestNo: guest.guestNo,
        guestName: guest.name,
        phone: guest.mobile,
        email: guest.email,
        nationality: guest.nationality,
        gender: guest.gender,
        dob: guest.dob,
        address: guest.address,
        city: guest.city,
        state: guest.state,
        country: guest.country,
        pincode: guest.pincode,
        idProofType: guest.idType,
        idNumber: guest.idNumber,
    };
}
function applyGroupFields(row, group) {
    if (!group)
        return row;
    const hasGuest = Boolean(String(row.guestId ?? "").trim());
    const ownerName = String(group.contactName ?? "").trim() ||
        String(group.companyName ?? "").trim() ||
        String(group.groupName ?? "").trim() ||
        "Group";
    return {
        ...row,
        groupId: group.id,
        groupName: group.groupName ?? null,
        groupNo: group.groupNo ?? null,
        guestName: hasGuest
            ? row.guestName
            : row.guestName?.trim() && row.guestName !== "Unassigned"
                ? row.guestName
                : ownerName,
        phone: hasGuest
            ? row.phone
            : row.phone || group.contactPhone || undefined,
    };
}
function applySourceFields(row, source) {
    return {
        ...row,
        sourceId: row.sourceId ?? null,
        source: source?.name ?? row.source ?? "",
    };
}
function applyRoomFields(row, room) {
    const ref = String(row.roomRefId ?? "").trim();
    const storedNo = String(row.roomNo ?? "").trim();
    // Prefer master room number; fall back to stored / human roomRef (not UUID).
    const resolvedNo = room?.roomNo ||
        storedNo ||
        (ref && isRealRoomRef(ref) && !/^[0-9a-f-]{36}$/i.test(ref) ? ref : "") ||
        null;
    return {
        ...row,
        roomRefId: room?.id ?? row.roomRefId ?? null,
        roomNo: resolvedNo,
        roomType: room?.roomType ??
            row.roomType ??
            row.requestedRoomType ??
            undefined,
    };
}
async function fetchGuestsByIds(ids) {
    const map = new Map();
    if (!ids.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.guests)
        .select("*")
        .in("id", ids);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const guest = toCamel(row);
        map.set(guest.id, guest);
    }
    return map;
}
async function fetchGroupsByIds(ids) {
    const map = new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length)
        return map;
    const { data, error } = await supabase
        .from(foModel.tables.foGroups)
        .select("id, group_name, group_no, contact_name, contact_phone, company_name")
        .in("id", unique);
    if (error)
        throw new Error(error.message);
    for (const row of data ?? []) {
        const g = toCamel(row);
        map.set(g.id, g);
    }
    return map;
}
/** Attach guest profile + room master fields for API responses. */
export async function enrichReservation(row) {
    const guestId = row.guestId ? String(row.guestId) : "";
    const roomRef = resolveRoomRef(row);
    const sourceId = row.sourceId ? String(row.sourceId) : "";
    const groupId = row.groupId ? String(row.groupId) : "";
    const [guestMap, roomMap, sourceMap, groupMap] = await Promise.all([
        guestId ? fetchGuestsByIds([guestId]) : Promise.resolve(new Map()),
        roomRef && isRealRoomRef(roomRef)
            ? fetchRoomsByRefs([roomRef])
            : Promise.resolve(new Map()),
        sourceId
            ? fetchBookingSourcesByIds([sourceId])
            : Promise.resolve(new Map()),
        groupId ? fetchGroupsByIds([groupId]) : Promise.resolve(new Map()),
    ]);
    let enriched = applyGuestFields(row, guestMap.get(guestId));
    enriched = applyRoomFields(enriched, roomRef ? lookupRoomInMap(roomMap, roomRef) : undefined);
    enriched = applySourceFields(enriched, sourceMap.get(sourceId));
    enriched = applyGroupFields(enriched, groupMap.get(groupId));
    return enriched;
}
export async function enrichReservations(rows) {
    if (!rows.length)
        return [];
    const guestIds = [
        ...new Set(rows.map((r) => r.guestId).filter(Boolean)),
    ];
    const roomRefs = [
        ...new Set(rows
            .map((r) => resolveRoomRef(r))
            .filter((ref) => !!ref && isRealRoomRef(ref))),
    ];
    const sourceIds = [
        ...new Set(rows.map((r) => r.sourceId).filter(Boolean)),
    ];
    const groupIds = [
        ...new Set(rows.map((r) => r.groupId).filter(Boolean)),
    ];
    const [guestMap, roomMap, sourceMap, groupMap] = await Promise.all([
        fetchGuestsByIds(guestIds),
        fetchRoomsByRefs(roomRefs),
        fetchBookingSourcesByIds(sourceIds),
        fetchGroupsByIds(groupIds),
    ]);
    return rows.map((row) => {
        const guestId = row.guestId ? String(row.guestId) : "";
        const roomRef = resolveRoomRef(row);
        const sourceId = row.sourceId ? String(row.sourceId) : "";
        const groupId = row.groupId ? String(row.groupId) : "";
        let enriched = applyGuestFields(row, guestMap.get(guestId));
        enriched = applyRoomFields(enriched, roomRef ? lookupRoomInMap(roomMap, roomRef) : undefined);
        enriched = applySourceFields(enriched, sourceMap.get(sourceId));
        enriched = applyGroupFields(enriched, groupMap.get(groupId));
        return enriched;
    });
}
/** Load guest name for activity logs and room inventory updates. */
export async function guestDisplayName(guestId, fallback = "Guest") {
    if (!guestId)
        return fallback;
    const guest = await foModel.get(foModel.tables.guests, guestId);
    return guest?.name?.trim() || fallback;
}
//# sourceMappingURL=reservation-enrich.js.map
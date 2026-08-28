import type { Reservation } from "../../types/front-office.js";
/** Placeholders like TBA must never touch the rooms table. */
export declare function isRealRoomRef(roomRef: unknown): roomRef is string;
/** Prefer human room number for UI (never expose rooms.id UUID). */
export declare function displayRoomNo(row: Partial<Reservation>): string;
/** Resolve room ref from API payload (roomRefId or legacy roomNo). */
export declare function resolveRoomRef(input: Partial<Reservation>): string | null;
/** Resolve source ref from API payload (sourceId or legacy source name). */
export declare function resolveSourceRef(input: Partial<Reservation>): string | null;
/** Strip denormalized guest/room/source fields before DB write. */
export declare function sanitizeReservationInput(input: Partial<Reservation>): Record<string, unknown>;
/** Resolve room number / UUID from API to rooms.id for FK storage. */
export declare function normalizeReservationRoomRef(body: Record<string, unknown>): Promise<void>;
/** Resolve source name / code / UUID from API to booking_sources.id for FK storage. */
export declare function normalizeReservationSourceRef(body: Record<string, unknown>): Promise<void>;
/** Attach guest profile + room master fields for API responses. */
export declare function enrichReservation(row: Reservation): Promise<Reservation>;
export declare function enrichReservations(rows: Reservation[]): Promise<Reservation[]>;
/** Load guest name for activity logs and room inventory updates. */
export declare function guestDisplayName(guestId: string | null | undefined, fallback?: string): Promise<string>;

type Row = Record<string, unknown>;
export type ReservationStatus = "Confirmed" | "Seated" | "Completed" | "No Show" | "Cancelled";
/**
 * Where a reservation stands right now. Only `reserved` and `late` hold the table:
 * upcoming → (start − buffer) reserved → start → late → (start + grace) overdue → auto No Show.
 */
export type ReservationPhase = "unscheduled" | "upcoming" | "reserved" | "late" | "overdue" | "seated" | "completed" | "no_show" | "cancelled";
export type ReservationSettings = {
    scopeKey: string;
    bufferBeforeMin: number;
    gracePeriodMin: number;
    defaultDurationMin: number;
    updatedAt?: string;
};
export type EnrichedReservation = Row & {
    id: string;
    resNo: string;
    outletId: string;
    guest: string;
    phone: string;
    covers: number;
    tableNo: string;
    tableNos: string[];
    status: ReservationStatus;
    reservationDate: string | null;
    time: string;
    durationMin: number;
    startsAt: string | null;
    endsAt: string | null;
    blockFrom: string | null;
    graceEndsAt: string | null;
    bufferBeforeMin: number;
    gracePeriodMin: number;
    phase: ReservationPhase;
    sessionId: string | null;
};
export type TableReservationOverlay = {
    id: string;
    resNo: string;
    guest: string;
    phone: string;
    time: string;
    covers: number;
    startsAt: string | null;
    blockFrom: string | null;
    graceEndsAt: string | null;
    endsAt: string | null;
    phase: ReservationPhase;
    /** Window is active but the table is physically taken by someone else. */
    conflict: boolean;
};
/** Merged bookings keep several tables in one field, e.g. "T-14A+T-14B". */
export declare function reservationTableNos(tableNo: unknown): string[];
export declare const isBlockingPhase: (phase: ReservationPhase) => phase is "reserved" | "late";
declare function getEnriched(id: string): Promise<EnrichedReservation>;
export declare const TableReservationService: {
    /** Throttled unless forced; safe to call before every floor or list read. */
    sweep(options?: {
        force?: boolean;
    }): Promise<{
        noShows: number;
        completed: number;
    }>;
    list(query: {
        date?: string;
        outletId?: string;
        status?: string;
    }): Promise<EnrichedReservation[]>;
    get: typeof getEnriched;
    create: (body: Row) => Promise<EnrichedReservation>;
    update: (id: string, body: Row) => Promise<EnrichedReservation>;
    remove(id: string): Promise<void>;
    markNoShow(id: string): Promise<EnrichedReservation>;
    cancel(id: string, reason?: string): Promise<EnrichedReservation>;
    /** Guest arrived: open a dining session on the table and link it. */
    seat(id: string, body: {
        tableNo?: string;
        override?: boolean;
        server?: string;
    }): Promise<{
        reservation: EnrichedReservation;
        session: Row;
        liveTableId: string;
        tableNo: string;
    }>;
    /** Party finished. Closes an empty session; a session with an open order must be settled first. */
    complete(id: string): Promise<EnrichedReservation>;
    completeForSession(sessionId: string): Promise<void>;
    /** A confirmed booking currently holding this table, if any. */
    activeBlockingReservation(outletId: string, tableNo: string): Promise<EnrichedReservation | null>;
    blockingMessage(r: EnrichedReservation, tableNo: string): string;
    /** Per-table reservation overlay for the floor plan. */
    floorOverlay(outletId?: string): Promise<(table: Row) => TableReservationOverlay | null>;
    getSettings(): Promise<{
        global: ReservationSettings;
        outlets: ReservationSettings[];
    }>;
    saveSettings(scopeKey: string, body: Row): Promise<{
        global: ReservationSettings;
        outlets: ReservationSettings[];
    }>;
    deleteSettings(scopeKey: string): Promise<{
        global: ReservationSettings;
        outlets: ReservationSettings[];
    }>;
    startSweeper(intervalMs?: number): void;
};
export {};

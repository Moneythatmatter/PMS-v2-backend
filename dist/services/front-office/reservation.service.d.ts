import type { InHouseGuest, Reservation, SummaryCard } from "../../types/front-office.js";
/**
 * ReservationService — business workflows for FO reservations.
 * Check-in / check-out prefer transactional Postgres RPCs when available.
 */
export declare const ReservationService: {
    list(status?: string): Promise<Reservation[]>;
    getById(id: string): Promise<Reservation>;
    create(input: Partial<Reservation> & {
        externalReference?: string | null;
        paymentReference?: string | null;
    }): Promise<Reservation>;
    update(id: string, input: Partial<Reservation>): Promise<Reservation>;
    remove(id: string): Promise<{
        id: string;
    }>;
    /**
     * Check-in (transactional via fo_check_in_reservation RPC when applied).
     * Fallback: sequential writes if RPC is not installed yet.
     */
    checkIn(id: string, extras?: Partial<Reservation>): Promise<Reservation>;
    checkInFallback(reservationId: string, existing: Reservation, extras: Partial<Reservation>): Promise<Reservation>;
    /**
     * Check-out (transactional via fo_check_out_reservation RPC when applied).
     */
    checkOut(id: string, options?: {
        paymentMode?: string;
        amountReceived?: number;
        externalReference?: string | null;
    }): Promise<Reservation>;
    checkOutFallback(reservationId: string, existing: Reservation, options: {
        paymentMode?: string;
        amountReceived?: number;
        externalReference?: string | null;
    }): Promise<Reservation>;
    extendStay(id: string, payload: {
        checkOut: string;
        nights?: unknown;
        totalAmount?: unknown;
        balance?: unknown;
    }): Promise<Reservation>;
    getSummary(): Promise<SummaryCard[]>;
    listInHouse(): Promise<InHouseGuest[]>;
    /** Latest reservation for a room (in-house > reserved > recent checkout). */
    findCurrentForRoom(roomKey: string): Promise<Reservation | null>;
};

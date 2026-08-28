import type { Folio } from "../../types/transactions.js";
export type FolioListItem = Folio & {
    guestName?: string;
    guestNo?: string | null;
    room?: string | null;
    roomType?: string | null;
    bookingNo?: string | null;
    checkIn?: string | null;
    checkOut?: string | null;
    reservationStatus?: string | null;
};
export declare const FolioService: {
    list(filters?: {
        bookingId?: string;
        guestId?: string;
        status?: string;
    }): Promise<FolioListItem[]>;
    getById(id: string): Promise<FolioListItem | null>;
};

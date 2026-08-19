import { type GuestRequest } from "../../types/housekeeping.js";
export declare const GuestRequestService: {
    list(filters?: {
        status?: string;
        roomId?: string;
        bookingId?: string;
        requestType?: string;
    }): Promise<GuestRequest[]>;
    get(id: string): Promise<GuestRequest>;
    create(input: Record<string, unknown>): Promise<GuestRequest>;
    update(id: string, input: Record<string, unknown>): Promise<GuestRequest>;
    assign(id: string, assignedTo: string): Promise<GuestRequest>;
    start(id: string): Promise<GuestRequest>;
    complete(id: string, notes?: string): Promise<GuestRequest>;
    cancel(id: string, notes?: string): Promise<GuestRequest>;
};

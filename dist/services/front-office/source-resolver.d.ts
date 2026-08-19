export interface BookingSource {
    id: string;
    code?: string;
    name?: string;
    description?: string;
    status?: string;
}
/** Resolve booking source UUID, code, or display name → booking_sources.id */
export declare function resolveSourceId(ref: string | null | undefined): Promise<string | null>;
export declare function fetchBookingSourcesByIds(ids: string[]): Promise<Map<string, BookingSource>>;
export declare function defaultWalkInSourceId(): Promise<string | null>;

import type { Reservation } from "../../types/front-office.js";
/** Load reservation by UUID id or display booking_no (e.g. BK-12). */
export declare function getReservationByKey(key: string): Promise<Reservation | null>;
export declare function reservationDisplayNo(row: Partial<Reservation>): string;

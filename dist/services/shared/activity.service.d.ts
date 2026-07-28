import { type ActivityTypeValue } from "../../constants/front-office.js";
type LogInput = {
    type: ActivityTypeValue;
    message: string;
    guestId?: string | null;
    room?: string | null;
    reservationId?: string | null;
};
/**
 * Activity / desk logging — one standard format for FO events.
 * Message is prefixed with activity type for searchable history.
 */
export declare const ActivityService: {
    ActivityType: {
        readonly RESERVATION_CREATED: "RESERVATION_CREATED";
        readonly CHECK_IN: "CHECK_IN";
        readonly CHECK_OUT: "CHECK_OUT";
        readonly EXTEND_STAY: "EXTEND_STAY";
        readonly PAYMENT: "PAYMENT";
    };
    log(input: LogInput): Promise<unknown>;
};
export {};

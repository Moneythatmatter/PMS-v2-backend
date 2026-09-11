export type AbsenceProcessResult = {
    processed: number;
    created: number;
    skipped: number;
    date: string;
};
export declare function processAbsenceForProperty(propertyId: string, options?: {
    attendanceDate?: string;
    now?: Date;
}): Promise<AbsenceProcessResult>;
export { syncLeaveToAttendance, syncApprovedLeaveToAttendance } from "./leave-attendance-sync.service.js";

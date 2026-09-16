type EmployeeLike = {
    id: string;
    firstName?: string;
    lastName?: string;
    dob?: string | null;
    joinDate?: string | null;
    avatar?: string | null;
    department?: string | null;
    departmentId?: string | null;
    status?: string;
};
type HolidayLike = {
    id: string;
    holidayName: string;
    holidayDate: string;
    dayOfWeek?: string | null;
    category?: string | null;
    status?: string | null;
};
export type UpcomingBirthdayEvent = {
    id: string;
    employeeId: string;
    name: string;
    avatar: string;
    department: string;
    type: "birthday";
    eventDate: string;
    displayDate: string;
    daysUntil: number;
};
export type UpcomingAnniversaryEvent = {
    id: string;
    employeeId: string;
    name: string;
    avatar: string;
    department: string;
    type: "anniversary";
    eventDate: string;
    displayDate: string;
    daysUntil: number;
    years: number;
};
export type UpcomingHolidayEvent = {
    id: string;
    title: string;
    eventDate: string;
    displayDate: string;
    dayOfWeek: string;
    category: string;
    daysUntil: number;
    type: "holiday";
};
export declare function buildUpcomingBirthdays(employees: EmployeeLike[], options?: {
    fromDate?: Date;
    daysAhead?: number;
    departmentLookup?: Map<string, string>;
}): UpcomingBirthdayEvent[];
export declare function buildUpcomingAnniversaries(employees: EmployeeLike[], options?: {
    fromDate?: Date;
    daysAhead?: number;
    departmentLookup?: Map<string, string>;
}): UpcomingAnniversaryEvent[];
export declare function buildUpcomingHolidays(holidays: HolidayLike[], options?: {
    fromDate?: Date;
    daysAhead?: number;
}): UpcomingHolidayEvent[];
export {};

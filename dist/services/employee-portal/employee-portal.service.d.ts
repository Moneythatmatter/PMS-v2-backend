export declare function getEmployeeDashboard(input: {
    propertyId: string;
    employeeId: string;
}): Promise<{
    date: string;
    employee: {
        id: string;
        empCode: string;
        name: string;
        department: string;
        designation: string;
        shiftType: string;
        leaveBalance: {
            casual?: number;
            sick?: number;
            earned?: number;
        } | undefined;
    } | null;
    todayShift: {
        effectiveFrom: string;
        effectiveTo?: string | null;
        status?: string;
    } | null;
    todayAttendance: Record<string, unknown> | null;
    monthlySummary: {
        fromDate: string;
        toDate: string;
        totalDays: number;
        presentDays: number;
        records: number;
    };
    leaveBalance: {
        casual?: number;
        sick?: number;
        earned?: number;
    };
    pendingLeaveRequests: {
        status?: string;
    }[];
    pendingLeaveCount: number;
    latestPayslip: {} | null;
    overtime: {
        pending: {
            status?: string;
        }[];
        pendingCount: number;
        approvedCount: number;
    };
    upcomingBirthdays: import("../human-resources/upcoming-events.service.js").UpcomingBirthdayEvent[];
    upcomingHolidays: import("../human-resources/upcoming-events.service.js").UpcomingHolidayEvent[];
}>;
export declare function toEmployeeProfile(employee: Record<string, unknown>): {
    id: unknown;
    empCode: unknown;
    firstName: unknown;
    lastName: unknown;
    name: string;
    email: unknown;
    phone: unknown;
    gender: unknown;
    dob: unknown;
    address: unknown;
    joinDate: unknown;
    status: unknown;
    department: unknown;
    designation: unknown;
    employmentType: unknown;
    shiftType: unknown;
    reportingManager: unknown;
    emergencyContact: unknown;
    bloodGroup: unknown;
    bankAccount: unknown;
    bankName: unknown;
    ifscCode: unknown;
    panNumber: unknown;
    uanNumber: unknown;
    esicNumber: unknown;
    leaveBalance: unknown;
    avatar: unknown;
    photoUrl: unknown;
};

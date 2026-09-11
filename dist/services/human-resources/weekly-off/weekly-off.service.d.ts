export type WeeklyOffAssignment = {
    id: string;
    propertyId?: string;
    employeeId: string;
    offType?: string;
    days?: string[];
    rotationPattern?: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    status?: string | null;
};
export type WeeklyOffResolution = {
    isWeeklyOff: boolean;
    assignmentId?: string;
    day?: string;
    offType?: string;
};
export type StaffingPreviewEmployee = {
    employeeId: string;
    employeeName: string;
    department: string;
    designation: string;
    assignmentId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
};
export type StaffingPreviewResult = {
    day: string;
    effectiveFrom: string;
    effectiveTo: string;
    total: number;
    departmentCounts: Record<string, number>;
    employees: StaffingPreviewEmployee[];
};
export type WeeklyOffConflict = {
    assignmentId: string;
    days: string[];
    effectiveFrom: string;
    effectiveTo: string | null;
};
export declare function isExplicitlyDisabled(status?: string | null): boolean;
/** Target-date applicability — NOT display status. */
export declare function isEffectiveOnDate(effectiveFrom: string, effectiveTo: string | undefined | null, targetDate: string): boolean;
/** UI-only: derive Upcoming / Active / Expired from today's date. */
export declare function deriveDisplayStatus(effectiveFrom: string, effectiveTo: string | undefined | null, today: string): "Upcoming" | "Active" | "Expired";
export declare function rangesOverlap(fromA: string, toA: string | undefined | null, fromB: string, toB: string | undefined | null): boolean;
export declare function assignmentIncludesDay(assignment: WeeklyOffAssignment, day: string): boolean;
export declare function assignmentMatchesWeekday(assignment: WeeklyOffAssignment, targetDate: string): boolean;
export declare function daysOverlap(a: string[], b: string[]): boolean;
/** Pure resolver — authority for target-date weekly off. */
export declare function resolveWeeklyOffFromAssignments(assignments: WeeklyOffAssignment[], targetDate: string): WeeklyOffResolution;
export declare function resolveWeeklyOffForDate(input: {
    propertyId: string;
    employeeId: string;
    date: string;
}): Promise<WeeklyOffResolution>;
export declare function findEmployeeConflicts(input: {
    propertyId: string;
    employeeId: string;
    days: string[];
    effectiveFrom: string;
    effectiveTo?: string | null;
    excludeId?: string;
}): Promise<WeeklyOffConflict[]>;
export declare function findStaffingPreview(input: {
    propertyId: string;
    day: string;
    effectiveFrom: string;
    effectiveTo: string;
    department?: string;
    excludeEmployeeId?: string;
}): Promise<StaffingPreviewResult>;
export declare function formatConflictMessage(conflicts: WeeklyOffConflict[], employeeName?: string): string;

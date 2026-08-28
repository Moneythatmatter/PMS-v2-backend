import type { DamageReportRow } from "../../types/housekeeping.js";
export declare function sanitizeDamageReportInput(input: Record<string, unknown>): Record<string, unknown>;
export declare function persistDamageReportRow(payload: Record<string, unknown>, options: {
    mode: "create";
} | {
    mode: "update";
    id: string;
}, reporterLabel?: string): Promise<DamageReportRow>;
export declare function enrichDamageReport(row: DamageReportRow): Promise<DamageReportRow>;
export declare function enrichDamageReports(rows: DamageReportRow[]): Promise<DamageReportRow[]>;
export declare function resolveDamageReportId(key: string): Promise<string | null>;
export declare function resolveRoomIdForDamageReport(key: string): Promise<string | null>;
export declare function resolveGuestIdByName(input: unknown): Promise<string | null>;
export declare function resolveReporterUserId(input: unknown): Promise<string | null>;
export declare function resolveReporterUserLabel(input: unknown): Promise<string>;
export declare function parseReportedAt(input: unknown, fallback?: Date): string;
export declare function parseCost(input: unknown): number;

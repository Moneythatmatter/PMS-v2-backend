import { type DamageReportRow } from "../../types/housekeeping.js";
export declare const DamageReportService: {
    list(filters?: {
        status?: string;
        roomId?: string;
        damageType?: string;
        severity?: string;
    }): Promise<DamageReportRow[]>;
    get(id: string): Promise<DamageReportRow>;
    create(input: Record<string, unknown>): Promise<DamageReportRow>;
    update(id: string, input: Record<string, unknown>): Promise<DamageReportRow>;
    resolve(id: string, input?: Record<string, unknown>): Promise<DamageReportRow>;
};

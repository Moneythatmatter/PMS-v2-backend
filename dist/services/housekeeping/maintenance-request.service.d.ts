import { type MaintenanceRequestRow } from "../../types/housekeeping.js";
export declare const MaintenanceRequestService: {
    list(filters?: {
        status?: string;
        roomId?: string;
        publicAreaId?: string;
        issueType?: string;
        priority?: string;
    }): Promise<MaintenanceRequestRow[]>;
    get(id: string): Promise<MaintenanceRequestRow>;
    create(input: Record<string, unknown>): Promise<MaintenanceRequestRow>;
    update(id: string, input: Record<string, unknown>): Promise<MaintenanceRequestRow>;
    assign(id: string, assignedTo: string, estimatedCompletionAt?: string): Promise<MaintenanceRequestRow>;
    start(id: string): Promise<MaintenanceRequestRow>;
    complete(id: string, resolution?: string, notes?: string): Promise<MaintenanceRequestRow>;
    verify(id: string, verifiedBy: string, resolution?: string): Promise<MaintenanceRequestRow>;
    cancel(id: string, notes?: string): Promise<MaintenanceRequestRow>;
};

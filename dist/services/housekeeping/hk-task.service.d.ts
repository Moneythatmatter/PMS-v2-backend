import { type HkTask } from "../../types/housekeeping.js";
export declare const HkTaskService: {
    list(filters?: {
        status?: string;
        roomId?: string;
        bookingId?: string;
        taskType?: string;
    }): Promise<HkTask[]>;
    get(id: string): Promise<HkTask>;
    findActiveForRoom(roomKey: string): Promise<HkTask | null>;
    create(input: Record<string, unknown>): Promise<HkTask>;
    /** Called from checkout fallback when RPC is unavailable. */
    onCheckout(options: {
        roomId: string;
        bookingId: string;
        notes?: string;
        createdBy?: string;
    }): Promise<HkTask | null>;
    assign(id: string, assignedTo: string): Promise<HkTask>;
    start(id: string): Promise<HkTask>;
    complete(id: string, notes?: string): Promise<HkTask>;
    approve(id: string, approvedBy: string): Promise<HkTask>;
    cancel(id: string, notes?: string): Promise<HkTask>;
};

import { type LostFoundItemRow } from "../../types/housekeeping.js";
export declare const LostFoundItemService: {
    list(filters?: {
        status?: string;
        roomId?: string;
    }): Promise<LostFoundItemRow[]>;
    get(id: string): Promise<LostFoundItemRow>;
    create(input: Record<string, unknown>): Promise<LostFoundItemRow>;
    update(id: string, input: Record<string, unknown>): Promise<LostFoundItemRow>;
    returnItem(id: string, input?: Record<string, unknown>): Promise<LostFoundItemRow>;
    claimItem(id: string, input?: Record<string, unknown>): Promise<LostFoundItemRow>;
    disposeItem(id: string, input?: Record<string, unknown>): Promise<LostFoundItemRow>;
    courierDispatch(id: string, input?: Record<string, unknown>): Promise<LostFoundItemRow>;
};

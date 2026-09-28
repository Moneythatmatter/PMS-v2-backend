import type { FolioCharge } from "../../types/transactions.js";
import type { FoChargeCategoryValue } from "../../constants/front-office.js";
export type PostFolioChargeInput = {
    reservationId: string;
    chargeCategory: FoChargeCategoryValue | string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    amount?: number;
    sourceModule?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    createdBy?: string | null;
    /** When set, skip router and post directly to this folio. */
    folioId?: string | null;
    groupId?: string | null;
    guestId?: string | null;
    responsibility?: string | null;
};
export declare const FolioChargeService: {
    list(filters?: {
        folioId?: string;
        groupId?: string;
        reservationId?: string;
    }): Promise<FolioCharge[]>;
    recalc(folioId: string): Promise<void>;
    /**
     * Insert a charge onto the paying folio (via charge router unless folioId given),
     * then recalc folio header from charges.
     */
    post(input: PostFolioChargeInput): Promise<FolioCharge>;
};

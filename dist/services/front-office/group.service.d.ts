import { FoGroupStatus } from "../../constants/front-office.js";
import type { FoGroup, FoGroupBillingRule, Reservation } from "../../types/front-office.js";
import type { FolioListItem } from "../shared/folio.service.js";
export type CreateGroupRoomLine = {
    roomType: string;
    quantity?: number;
    roomRate?: number;
    tariffPlan?: string | null;
    mealPlan?: string | null;
    adults?: number;
    children?: number;
};
export type CreateGroupBillingRule = {
    chargeCategory: string;
    responsibility: string;
};
export type CreateGroupInput = {
    groupName: string;
    groupType?: string;
    contactGuestId?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    companyName?: string | null;
    arrivalDate: string;
    departureDate: string;
    nights?: number;
    notes?: string | null;
    idempotencyKey?: string;
    roomLines: CreateGroupRoomLine[];
    billingRules?: CreateGroupBillingRule[];
    advancePaid?: number;
    paymentMode?: string | null;
    externalReference?: string | null;
    createdBy?: string | null;
};
export type CreateGroupResult = {
    groupId: string;
    idempotent: boolean;
    reservationIds: string[];
    masterFolioId?: string | null;
    group?: FoGroup;
};
export type UpdateGroupInput = {
    groupName?: string;
    groupType?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    companyName?: string | null;
    arrivalDate?: string;
    departureDate?: string;
    notes?: string | null;
    status?: string;
    updatedBy?: string | null;
};
export declare const GroupService: {
    list(status?: string): Promise<FoGroup[]>;
    getById(id: string): Promise<FoGroup>;
    listReservations(groupId: string): Promise<Reservation[]>;
    listBillingRules(groupId: string): Promise<FoGroupBillingRule[]>;
    getMasterFolio(groupId: string): Promise<FolioListItem | null>;
    ensureMasterFolio(groupId: string): Promise<FolioListItem>;
    updateBillingRules(groupId: string, rules: CreateGroupBillingRule[]): Promise<FoGroupBillingRule[]>;
    create(input: CreateGroupInput): Promise<CreateGroupResult>;
    update(id: string, input: UpdateGroupInput): Promise<FoGroup>;
};
export { FoGroupStatus };

export type RoomBlockKind = "maintenance" | "blocked";
export type RoomAvailabilityBlock = {
    roomId: string;
    startDate: string;
    endDate: string;
    kind: RoomBlockKind;
    reason?: string;
    sourceType?: string;
    sourceId?: string;
};
/** Merge manual blocks + maintenance_requests that explicitly block the room. */
export declare function fetchRoomAvailabilityBlocks(roomIds: string[], rangeStart: string, rangeEnd: string): Promise<Map<string, RoomAvailabilityBlock[]>>;
export declare function blockKindForDay(blocks: RoomAvailabilityBlock[], dayIso: string): "none" | RoomBlockKind;
export declare function blocksOverlapStay(blocks: RoomAvailabilityBlock[], checkIn: string, checkOut: string): boolean;
export type RoomAvailabilityBlockRow = RoomAvailabilityBlock & {
    roomNo?: string;
};
/** Flat list for API consumers (reservation picker, calendar legend). */
export declare function listRoomAvailabilityBlocksForRange(rangeStart: string, rangeEnd: string): Promise<RoomAvailabilityBlockRow[]>;

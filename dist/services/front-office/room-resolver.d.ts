import type { Room } from "../../types/front-office.js";
export declare function isRoomUuid(value: string): boolean;
/** Resolve room number or UUID to the rooms.id UUID for FK storage. */
export declare function resolveRoomId(ref: string | null | undefined): Promise<string | null>;
/** Load room by UUID id or display room number. */
export declare function getRoomByRef(ref: string | null | undefined): Promise<Room | null>;
/** Batch-fetch rooms by id and/or room_no; map keyed by rooms.id. */
export declare function fetchRoomsByRefs(refs: string[]): Promise<Map<string, Room>>;
export declare function lookupRoomInMap(map: Map<string, Room>, ref: string | null | undefined): Room | undefined;

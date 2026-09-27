/**
 * Ensure a maintenance room ops row exists for an FO room.
 * Mirrors ensureHkRoomForFoRoom.
 */
export declare function ensureMntRoomForFoRoom(roomId: string): Promise<void>;
/**
 * Ensure a maintenance public-area ops row exists for an HK public_areas master.
 */
export declare function ensureMntPublicAreaForMaster(publicAreaId: string): Promise<void>;
/** Backfill any FO rooms missing an mnt_rooms row (current property scope). */
export declare function ensureAllMntRooms(): Promise<void>;
/** Backfill any HK public_areas missing an mnt_public_areas row. */
export declare function ensureAllMntPublicAreas(): Promise<void>;

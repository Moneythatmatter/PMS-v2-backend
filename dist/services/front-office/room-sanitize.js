/** Strip operational / read-only fields from room master writes. */
export function sanitizeRoomInput(input) {
    const body = { ...input };
    delete body.guestName;
    delete body.housekeeping;
    delete body.maintenance;
    delete body.checkoutDate;
    delete body.status;
    delete body.updatedAt;
    delete body.createdAt;
    if (body.isActive !== undefined) {
        body.isActive = Boolean(body.isActive);
    }
    if (body.maxOccupancy !== undefined) {
        body.maxOccupancy = Number(body.maxOccupancy);
    }
    return body;
}
//# sourceMappingURL=room-sanitize.js.map
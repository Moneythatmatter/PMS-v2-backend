import { hkModel } from "../../models/housekeeping/index.js";
import { AppError, ConflictError, NotFoundError } from "../../errors/index.js";
import {
  enrichLostFoundItem,
  enrichLostFoundItems,
  parseFoundAt,
  persistLostFoundItemRow,
  resolveFoundByUserId,
  resolveFoundByUserLabel,
  resolveGuestIdByName,
  resolveLostFoundItemId,
  resolveRoomIdForLostFound,
  sanitizeLostFoundItemInput,
} from "./lost-found-item-enrich.js";
import {
  normalizeLostFoundCategory,
  normalizeLostFoundReturnMethod,
  normalizeLostFoundStatus,
  type LostFoundItemRow,
  type LostFoundStatus,
} from "../../types/housekeeping.js";

const CLOSED_STATUSES: LostFoundStatus[] = [
  "RETURNED",
  "CLAIMED",
  "DISPOSED",
  "COURIER_DISPATCHED",
];

async function getItemOrThrow(id: string): Promise<LostFoundItemRow> {
  const row = await hkModel.get<LostFoundItemRow>(
    hkModel.shared.lostFoundItems,
    id,
  );
  if (!row) throw new NotFoundError("Lost & found item not found");
  return row;
}

async function appendHistory(entry: {
  user: string;
  category: string;
  action: string;
  room?: string;
  details: string;
}) {
  await hkModel.create(hkModel.tables.history, {
    id: hkModel.newId("H"),
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

export const LostFoundItemService = {
  async list(filters: { status?: string; roomId?: string } = {}): Promise<
    LostFoundItemRow[]
  > {
    const queryFilters: Record<string, string | undefined> = {};
    if (filters.status) {
      queryFilters.status = normalizeLostFoundStatus(filters.status);
    }

    let rows = await hkModel.list<LostFoundItemRow>(
      hkModel.shared.lostFoundItems,
      {
        filters: queryFilters,
        orderBy: "found_at",
        ascending: false,
      },
    );

    if (filters.roomId) {
      const roomId =
        (await resolveRoomIdForLostFound(filters.roomId)) ?? filters.roomId;
      rows = rows.filter((r) => String(r.roomId) === roomId);
    }

    return enrichLostFoundItems(rows);
  },

  async get(id: string): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");
    return enrichLostFoundItem(await getItemOrThrow(resolved));
  },

  async create(input: Record<string, unknown>): Promise<LostFoundItemRow> {
    const body = sanitizeLostFoundItemInput(input);

    const itemName = String(body.itemName ?? "").trim();
    if (!itemName) throw new AppError("itemName is required", 400);
    body.itemName = itemName;

    body.category = normalizeLostFoundCategory(body.category ?? "OTHER");
    body.status = normalizeLostFoundStatus(body.status ?? "STORED");

    const foundLocation = String(body.foundLocation ?? "").trim();
    body.foundLocation = foundLocation || "Unknown";

    if (body.roomId != null) {
      const roomKey = String(body.roomId).trim();
      body.roomId = roomKey
        ? (await resolveRoomIdForLostFound(roomKey)) ?? roomKey
        : null;
    }

    const guestRaw = String(body.guest ?? "").trim();
    body.guestId = guestRaw
      ? await resolveGuestIdByName(guestRaw)
      : null;

    const foundByRaw = String(body.foundBy ?? "").trim();
    const foundByLabel =
      (await resolveFoundByUserLabel(foundByRaw)) || foundByRaw;
    const resolvedFoundBy = foundByRaw
      ? await resolveFoundByUserId(foundByRaw)
      : null;

    body.foundAt = parseFoundAt(body.foundAt);
    body.returnMethod = normalizeLostFoundReturnMethod(body.returnMethod);

    if (!body.id) body.id = hkModel.newId();

    delete body.guest;
    delete body.guestName;

    const saved = await persistLostFoundItemRow(
      {
        ...body,
        foundBy: resolvedFoundBy,
        guest: undefined,
      },
      { mode: "create" },
      foundByLabel || undefined,
    );

    const row = await enrichLostFoundItem({
      ...saved,
      foundByName: foundByLabel || undefined,
      guestName: guestRaw && guestRaw !== "Unknown" ? guestRaw : undefined,
    });

    await appendHistory({
      user: foundByLabel || "Housekeeping",
      category: "Lost & Found",
      action: "Item Registered",
      room: row.roomNo ?? row.foundLocation,
      details: `${row.itemNumber ?? row.id}: ${itemName} — ${foundLocation}`,
    });

    return row;
  },

  async update(
    id: string,
    input: Record<string, unknown>,
  ): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");
    const existing = await getItemOrThrow(resolved);

    if (CLOSED_STATUSES.includes(existing.status)) {
      throw new ConflictError(
        `Cannot edit item in status ${existing.status}`,
      );
    }

    const body = sanitizeLostFoundItemInput(input);
    const patch: Record<string, unknown> = {};

    if (body.itemName != null) {
      const itemName = String(body.itemName).trim();
      if (!itemName) throw new AppError("itemName is required", 400);
      patch.itemName = itemName;
    }
    if (body.description != null) patch.description = body.description;
    if (body.category != null) {
      patch.category = normalizeLostFoundCategory(body.category);
    }
    if (body.foundLocation != null) {
      patch.foundLocation = String(body.foundLocation).trim() || "Unknown";
    }
    if (body.storedLocation != null) patch.storedLocation = body.storedLocation;
    if (body.notes != null) patch.notes = body.notes;
    if (body.status != null) {
      patch.status = normalizeLostFoundStatus(body.status);
    }

    if (body.roomId != null) {
      const roomKey = String(body.roomId).trim();
      patch.roomId = roomKey
        ? (await resolveRoomIdForLostFound(roomKey)) ?? roomKey
        : null;
    }

    if (body.guest != null) {
      const guestRaw = String(body.guest).trim();
      patch.guestId = guestRaw
        ? await resolveGuestIdByName(guestRaw)
        : null;
    }

    if (body.foundBy != null) {
      const foundByRaw = String(body.foundBy).trim();
      const foundByLabel =
        (await resolveFoundByUserLabel(foundByRaw)) || foundByRaw;
      patch.foundBy = foundByRaw
        ? await resolveFoundByUserId(foundByRaw)
        : null;

      const saved = await persistLostFoundItemRow(
        patch,
        { mode: "update", id: resolved },
        foundByLabel || undefined,
      );
      return enrichLostFoundItem({
        ...saved,
        foundByName: foundByLabel || undefined,
      });
    }

    const saved = await persistLostFoundItemRow(patch, {
      mode: "update",
      id: resolved,
    });
    return enrichLostFoundItem(saved);
  },

  async returnItem(
    id: string,
    input: Record<string, unknown> = {},
  ): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");
    const existing = await getItemOrThrow(resolved);

    if (CLOSED_STATUSES.includes(existing.status)) {
      throw new ConflictError(`Item already ${existing.status.toLowerCase()}`);
    }

    const returnedTo = String(
      input.returnedTo ?? input.claimBy ?? input.guest ?? "",
    ).trim();
    const nowIso = new Date().toISOString();
    const returnMethod = normalizeLostFoundReturnMethod(
      input.returnMethod ?? "IN_PERSON",
    );

    const saved = await persistLostFoundItemRow(
      {
        status: "RETURNED",
        returnedTo: returnedTo || null,
        claimedAt: nowIso,
        returnMethod: returnMethod ?? "IN_PERSON",
        notes: input.notes ?? existing.notes,
      },
      { mode: "update", id: resolved },
    );

    const row = await enrichLostFoundItem({
      ...saved,
      guestName: returnedTo || undefined,
    });

    await appendHistory({
      user: returnedTo || "Front Desk",
      category: "Lost & Found",
      action: "Item Returned",
      room: row.roomNo ?? row.foundLocation,
      details: `Returned "${row.itemName}" to ${returnedTo || "guest"}`,
    });

    return row;
  },

  async claimItem(
    id: string,
    input: Record<string, unknown> = {},
  ): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");
    const existing = await getItemOrThrow(resolved);

    if (CLOSED_STATUSES.includes(existing.status)) {
      throw new ConflictError(`Item already ${existing.status.toLowerCase()}`);
    }

    const claimant = String(
      input.claimedBy ?? input.claimBy ?? input.guest ?? input.returnedTo ?? "",
    ).trim();
    const guestId = claimant ? await resolveGuestIdByName(claimant) : null;
    const nowIso = new Date().toISOString();

    const saved = await persistLostFoundItemRow(
      {
        status: "CLAIMED",
        claimedBy: guestId,
        returnedTo: claimant || null,
        claimedAt: nowIso,
        returnMethod:
          normalizeLostFoundReturnMethod(input.returnMethod) ?? "IN_PERSON",
        notes: input.notes ?? existing.notes,
      },
      { mode: "update", id: resolved },
    );

    const row = await enrichLostFoundItem({
      ...saved,
      guestName: claimant || undefined,
      claimedByName: claimant || undefined,
    });

    await appendHistory({
      user: claimant || "Guest",
      category: "Lost & Found",
      action: "Item Claimed",
      room: row.roomNo ?? row.foundLocation,
      details: `"${row.itemName}" claimed by ${claimant || "guest"}`,
    });

    return row;
  },

  async disposeItem(
    id: string,
    input: Record<string, unknown> = {},
  ): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");

    const saved = await persistLostFoundItemRow(
      {
        status: "DISPOSED",
        notes: input.notes ?? input.remarks,
        claimedAt: new Date().toISOString(),
      },
      { mode: "update", id: resolved },
    );

    const row = await enrichLostFoundItem(saved);

    await appendHistory({
      user: "Housekeeping",
      category: "Lost & Found",
      action: "Item Disposed",
      room: row.roomNo ?? row.foundLocation,
      details: `Disposed "${row.itemName}"`,
    });

    return row;
  },

  async courierDispatch(
    id: string,
    input: Record<string, unknown> = {},
  ): Promise<LostFoundItemRow> {
    const resolved = await resolveLostFoundItemId(id);
    if (!resolved) throw new NotFoundError("Lost & found item not found");

    const saved = await persistLostFoundItemRow(
      {
        status: "COURIER_DISPATCHED",
        returnMethod: "COURIER",
        returnedTo: input.returnedTo ?? input.recipient ?? null,
        notes: input.notes ?? input.trackingNumber,
        claimedAt: new Date().toISOString(),
      },
      { mode: "update", id: resolved },
    );

    const row = await enrichLostFoundItem(saved);

    await appendHistory({
      user: "Housekeeping",
      category: "Lost & Found",
      action: "Courier Dispatched",
      room: row.roomNo ?? row.foundLocation,
      details: `Courier dispatched for "${row.itemName}"`,
    });

    return row;
  },
};

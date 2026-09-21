/** Document helpers for Engineering Maintenance (mnt_*) tables. */

export function withMntDocumentDefaults(
  body: Record<string, unknown>,
  options: {
    numberField: string;
    prefix: string;
    dateDefaults?: Record<string, string>;
  },
): Record<string, unknown> {
  const out = { ...body };
  const today = new Date().toISOString().slice(0, 10);

  if (!out[options.numberField]) {
    const year = new Date().getFullYear();
    const suffix = Date.now().toString(36).slice(-5).toUpperCase();
    out[options.numberField] = `${options.prefix}-${year}-${suffix}`;
  }

  if (options.dateDefaults) {
    for (const [field, fallback] of Object.entries(options.dateDefaults)) {
      if (!out[field]) out[field] = fallback === "today" ? today : fallback;
    }
  }

  return out;
}

type DocPackOptions = {
  /** Scalar columns mirrored outside payload for filtering / indexes. */
  filterKeys: string[];
};

/** Pack FE entity into filter columns + full payload jsonb. */
export function packMntDocument(
  body: Record<string, unknown>,
  options: DocPackOptions,
): Record<string, unknown> {
  const payload = { ...body };
  const propertyId = payload.propertyId ?? payload.property_id;
  delete payload.propertyId;
  delete payload.property_id;

  const row: Record<string, unknown> = { payload };
  // Keep property_id as a real column (never only inside payload jsonb).
  if (propertyId != null && propertyId !== "") {
    row.propertyId = propertyId;
  }
  for (const key of options.filterKeys) {
    if (payload[key] !== undefined) row[key] = payload[key];
  }
  if (payload.id) row.id = payload.id;
  return row;
}

/** Unpack DB row into FE entity (payload merged with filter columns). */
export function unpackMntDocument<T extends Record<string, unknown>>(row: T): T {
  const r = row as Record<string, unknown>;
  const payload =
    r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : {};
  const { payload: _drop, createdAt: dbCreatedAt, updatedAt: _u, propertyId, ...cols } = r;
  return {
    ...payload,
    ...cols,
    ...(propertyId != null ? { propertyId } : {}),
    ...(payload.createdAt ? {} : dbCreatedAt != null ? { createdAt: dbCreatedAt } : {}),
  } as T;
}

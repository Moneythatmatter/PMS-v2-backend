/** Ensure required document fields before insert into ps_* tables. */
export function withPsDocumentDefaults(
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

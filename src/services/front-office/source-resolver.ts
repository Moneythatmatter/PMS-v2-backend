import { supabase } from "../../utils/supabase.js";
import { foModel } from "../../models/front-office/index.js";
import { toCamel } from "../../utils/mappers.js";
import { isRoomUuid } from "./room-resolver.js";

export interface BookingSource {
  id: string;
  code?: string;
  name?: string;
  description?: string;
  status?: string;
}

let sourceCache: BookingSource[] | null = null;

async function loadBookingSources(): Promise<BookingSource[]> {
  if (sourceCache) return sourceCache;
  const { data, error } = await supabase
    .from(foModel.tables.bookingSources)
    .select("*");
  if (error) throw new Error(error.message);
  sourceCache = (data ?? []).map((row) => toCamel<BookingSource>(row));
  return sourceCache;
}

/** Resolve booking source UUID, code, or display name → booking_sources.id */
export async function resolveSourceId(
  ref: string | null | undefined,
): Promise<string | null> {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return null;

  if (isRoomUuid(trimmed)) {
    const sources = await loadBookingSources();
    return sources.some((s) => s.id === trimmed) ? trimmed : null;
  }

  const normalized = trimmed.toLowerCase();
  const sources = await loadBookingSources();

  for (const source of sources) {
    const name = String(source.name ?? "").toLowerCase();
    const code = String(source.code ?? "").toLowerCase();
    if (name === normalized || code === normalized) return source.id;
  }

  const aliasCode =
    normalized === "direct" || normalized === "website"
      ? "web"
      : normalized === "walk-in" || normalized === "walkin"
        ? "walkin"
        : normalized === "booking.com"
          ? "bcom"
          : normalized === "makemytrip"
            ? "mmt"
            : null;

  if (aliasCode) {
    const match = sources.find(
      (s) => String(s.code ?? "").toLowerCase() === aliasCode,
    );
    if (match) return match.id;
  }

  return null;
}

export async function fetchBookingSourcesByIds(
  ids: string[],
): Promise<Map<string, BookingSource>> {
  const map = new Map<string, BookingSource>();
  const unique = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (!unique.size) return map;

  const sources = await loadBookingSources();
  for (const source of sources) {
    if (unique.has(source.id)) map.set(source.id, source);
  }
  return map;
}

export async function defaultWalkInSourceId(): Promise<string | null> {
  const sources = await loadBookingSources();
  return sources.find((s) => String(s.code ?? "").toUpperCase() === "WALKIN")
    ?.id ?? null;
}

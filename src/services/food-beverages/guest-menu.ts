import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config/index.js";
import { AppError } from "../../errors/index.js";
import { fbModel } from "../../models/food-beverages/index.js";

type Row = Record<string, unknown>;

const MAX_LINES = 30;
const MAX_QTY = 20;
const MAX_TEXT = 500;

/** Matches outlet statuses that mean the outlet is not taking orders. */
export const CLOSED_OUTLET = /^(inactive|closed|maintenance|disabled)$/i;

export function cleanText(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_TEXT);
}

export function signScopedToken(scope: string, id: string): string {
  return createHmac("sha256", config.jwtSecret)
    .update(`guest-portal:${scope}:${id}`)
    .digest("base64url")
    .slice(0, 24);
}

export function scopedTokenMatches(scope: string, id: string, token: string): boolean {
  const expected = Buffer.from(signScopedToken(scope, id));
  const given = Buffer.from(String(token ?? ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Active menu items (price > 0) in active categories, as shown on guest-facing QR pages. */
export async function loadGuestMenu() {
  const [items, categories] = await Promise.all([
    fbModel.list<Row>(fbModel.tables.menuItems),
    fbModel.list<Row>(fbModel.tables.menuCategories),
  ]);
  const activeCategories = categories
    .filter((c) => c.isActive !== false)
    .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0));
  const categoryIds = new Set(activeCategories.map((c) => String(c.id)));
  return {
    categories: activeCategories.map((c) => ({ id: String(c.id), name: String(c.name ?? "") })),
    items: items
      .filter((i) => i.isActive !== false && Number(i.price ?? 0) > 0 && categoryIds.has(String(i.categoryId)))
      .map((i) => ({
        id: String(i.id),
        name: String(i.name ?? ""),
        description: String(i.description ?? ""),
        categoryId: String(i.categoryId),
        price: Number(i.price ?? 0),
        isVegetarian: Boolean(i.isVegetarian),
        imageUrl: i.imageUrl ? String(i.imageUrl) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type GuestPricedLine = { menuItemId: string; name: string; qty: number; unitPrice: number };

/** Prices guest-submitted lines from the menu master; never trusts client prices. */
export async function priceGuestLines(input: unknown): Promise<GuestPricedLine[]> {
  const requested = (Array.isArray(input) ? input : [])
    .map((l: { menuItemId?: unknown; qty?: unknown }) => ({
      menuItemId: String(l?.menuItemId ?? ""),
      qty: Math.floor(Number(l?.qty) || 0),
    }))
    .filter((l) => l.menuItemId && l.qty > 0);
  if (!requested.length) throw new AppError("Add at least one item to your order", 400);
  if (requested.length > MAX_LINES) throw new AppError("Too many items in one order", 400);

  const menu = await fbModel.list<Row>(fbModel.tables.menuItems);
  const byId = new Map(menu.map((m) => [String(m.id), m]));
  return requested.map((l) => {
    const item = byId.get(l.menuItemId);
    if (!item || item.isActive === false || !(Number(item.price ?? 0) > 0)) {
      throw new AppError("One of the items is no longer available. Please refresh the menu.", 400);
    }
    return {
      menuItemId: l.menuItemId,
      name: String(item.name ?? ""),
      qty: Math.min(l.qty, MAX_QTY),
      unitPrice: Number(item.price),
    };
  });
}


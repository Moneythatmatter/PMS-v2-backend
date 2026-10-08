import { supabase } from "../../utils/supabase.js";
import { toCamel } from "../../utils/mappers.js";
import { throwIfRlsError } from "../../utils/db-errors.js";
import { ValidationError } from "../../errors/index.js";
import { deleteRow, getRowById, insertRow, updateRow } from "../front-office/base.js";

export const modifierTables = {
  groups: "fb_modifier_groups",
  options: "fb_modifiers",
  itemGroups: "fb_menu_item_modifier_groups",
} as const;

export type SelectionType = "single" | "multiple";

export type ModifierOption = {
  id: string;
  groupId: string;
  code: string;
  name: string;
  price: number;
  isDefault: boolean;
  sortOrder: number;
  status: "Active" | "Inactive";
};

export type ModifierGroup = {
  id: string;
  code: string;
  name: string;
  description: string;
  selectionType: SelectionType;
  isRequired: boolean;
  minSelect: number;
  /** null = no upper limit */
  maxSelect: number | null;
  sortOrder: number;
  status: "Active" | "Inactive";
  options: ModifierOption[];
  menuItemIds: string[];
  createdAt: string;
};

/** Snapshot stored on fb_order_items.modifiers. */
export type SelectedModifier = {
  groupId: string;
  groupName: string;
  modifierId: string;
  name: string;
  price: number;
};

type GroupRow = Omit<ModifierGroup, "options" | "menuItemIds">;
type OptionRow = ModifierOption;
type LinkRow = { menuItemId: string; groupId: string; sortOrder: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v: unknown) => String(v ?? "").trim();
const status = (v: unknown): "Active" | "Inactive" => (v === "Inactive" || v === false ? "Inactive" : "Active");

type Filter = { column: string; eq?: string; in?: string[] };

async function selectAll<T>(table: string, filter?: Filter): Promise<T[]> {
  let query = supabase.from(table).select("*");
  if (filter?.eq !== undefined) query = query.eq(filter.column, filter.eq);
  if (filter?.in !== undefined) query = query.in(filter.column, filter.in);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return toCamel<T[]>(data ?? []);
}

function normalizeGroup(row: GroupRow): GroupRow {
  return {
    ...row,
    description: row.description ?? "",
    selectionType: row.selectionType === "multiple" ? "multiple" : "single",
    isRequired: row.isRequired === true,
    minSelect: num(row.minSelect),
    maxSelect: row.maxSelect === null || row.maxSelect === undefined ? null : num(row.maxSelect),
    sortOrder: num(row.sortOrder),
    status: status(row.status),
  };
}

function assemble(groups: GroupRow[], options: OptionRow[], links: LinkRow[]): ModifierGroup[] {
  const optionsByGroup = new Map<string, ModifierOption[]>();
  for (const o of options) {
    const list = optionsByGroup.get(o.groupId) ?? [];
    list.push({ ...o, price: num(o.price), isDefault: o.isDefault === true, sortOrder: num(o.sortOrder), status: status(o.status) });
    optionsByGroup.set(o.groupId, list);
  }
  const itemsByGroup = new Map<string, string[]>();
  for (const l of links) {
    const list = itemsByGroup.get(l.groupId) ?? [];
    list.push(l.menuItemId);
    itemsByGroup.set(l.groupId, list);
  }
  return groups
    .map(normalizeGroup)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((g) => ({
      ...g,
      options: (optionsByGroup.get(g.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      menuItemIds: itemsByGroup.get(g.id) ?? [],
    }));
}

export async function listGroups(): Promise<ModifierGroup[]> {
  const [groups, options, links] = await Promise.all([
    selectAll<GroupRow>(modifierTables.groups),
    selectAll<OptionRow>(modifierTables.options),
    selectAll<LinkRow>(modifierTables.itemGroups),
  ]);
  return assemble(groups, options, links);
}

export async function getGroup(id: string): Promise<ModifierGroup | null> {
  const group = await getRowById<GroupRow>(modifierTables.groups, id);
  if (!group) return null;
  const [options, links] = await Promise.all([
    selectAll<OptionRow>(modifierTables.options, { column: "group_id", eq: id }),
    selectAll<LinkRow>(modifierTables.itemGroups, { column: "group_id", eq: id }),
  ]);
  return assemble([group], options, links)[0];
}

/** Active groups for these menu items, in the item's display order, with active options only. */
export async function groupsForMenuItems(menuItemIds: string[]) {
  const ids = [...new Set(menuItemIds.filter((id) => UUID_RE.test(id)))];
  const byItem = new Map<string, ModifierGroup[]>();
  if (ids.length === 0) return byItem;
  const links = await selectAll<LinkRow>(modifierTables.itemGroups, { column: "menu_item_id", in: ids });
  const groupIds = [...new Set(links.map((l) => l.groupId))];
  if (groupIds.length === 0) return byItem;
  const [groups, options] = await Promise.all([
    selectAll<GroupRow>(modifierTables.groups, { column: "id", in: groupIds }),
    selectAll<OptionRow>(modifierTables.options, { column: "group_id", in: groupIds }),
  ]);
  const assembled = new Map(
    assemble(groups, options.filter((o) => status(o.status) === "Active"), []).map((g) => [g.id, g]),
  );
  for (const link of links.sort((a, b) => num(a.sortOrder) - num(b.sortOrder))) {
    const group = assembled.get(link.groupId);
    if (!group || group.status !== "Active" || group.options.length === 0) continue;
    const list = byItem.get(link.menuItemId) ?? [];
    list.push(group);
    byItem.set(link.menuItemId, list);
  }
  return byItem;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export function ruleText(group: Pick<ModifierGroup, "isRequired" | "minSelect" | "maxSelect" | "selectionType">) {
  if (group.selectionType === "single") return group.isRequired ? "Choose 1" : "Choose up to 1";
  const { minSelect: min, maxSelect: max } = group;
  if (max === null) return min > 0 ? `Choose at least ${min}` : "Choose any";
  if (min === max) return `Choose ${min}`;
  return min > 0 ? `Choose ${min}–${max}` : `Choose up to ${max}`;
}

/** Validate chosen option ids for one menu item and price them from the database. */
export function resolveSelections(itemName: string, groups: ModifierGroup[], modifierIds: string[]) {
  const chosen = new Set(modifierIds.map(String));
  const optionGroup = new Map<string, { group: ModifierGroup; option: ModifierOption }>();
  for (const group of groups) for (const option of group.options) optionGroup.set(option.id, { group, option });

  const unknown = [...chosen].filter((id) => !optionGroup.has(id));
  if (unknown.length > 0) {
    throw new ValidationError(`${itemName}: some selected modifiers are not available for this item any more.`);
  }

  const problems: string[] = [];
  const selected: SelectedModifier[] = [];
  for (const group of groups) {
    const picks = group.options.filter((o) => chosen.has(o.id));
    const count = picks.length;
    if (count < group.minSelect) problems.push(`${group.name}: ${ruleText(group).toLowerCase()}`);
    if (group.maxSelect !== null && count > group.maxSelect) problems.push(`${group.name}: ${ruleText(group).toLowerCase()}`);
    for (const o of picks) {
      selected.push({ groupId: group.id, groupName: group.name, modifierId: o.id, name: o.name, price: num(o.price) });
    }
  }
  if (problems.length > 0) throw new ValidationError(`${itemName} — ${problems.join("; ")}`);

  const total = Math.round(selected.reduce((s, m) => s + m.price, 0) * 100) / 100;
  return { selected, total };
}

// ── Writes ───────────────────────────────────────────────────────────────────

type OptionInput = {
  id?: string;
  code?: string;
  name?: string;
  price?: number | string;
  isDefault?: boolean;
  status?: string;
};

function buildRules(body: Record<string, unknown>, prev: GroupRow | null) {
  const selectionType: SelectionType =
    (body.selectionType ?? prev?.selectionType) === "multiple" ? "multiple" : "single";
  const isRequired = body.isRequired !== undefined ? body.isRequired === true || body.isRequired === "true" : prev?.isRequired === true;
  let minSelect = body.minSelect !== undefined ? Math.max(0, Math.floor(num(body.minSelect))) : num(prev?.minSelect);
  const rawMax = body.maxSelect !== undefined ? body.maxSelect : prev?.maxSelect;
  let maxSelect = rawMax === null || rawMax === undefined || rawMax === "" || num(rawMax) <= 0 ? null : Math.floor(num(rawMax));

  if (selectionType === "single") {
    maxSelect = 1;
    minSelect = isRequired ? 1 : 0;
  } else {
    minSelect = isRequired ? Math.max(1, minSelect) : 0;
  }

  const details: { path: string; message: string }[] = [];
  if (maxSelect !== null && maxSelect < Math.max(minSelect, 1)) {
    details.push({ path: "maxSelect", message: "Maximum selection can't be less than the minimum" });
  }
  return { rules: { selectionType, isRequired, minSelect, maxSelect }, details };
}

function buildOptions(groupId: string, raw: unknown, rules: { selectionType: SelectionType; maxSelect: number | null }) {
  if (!Array.isArray(raw)) return { rows: null, details: [] as { path: string; message: string }[] };
  const details: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  const rows = (raw as OptionInput[]).map((o, idx) => {
    const name = text(o.name);
    const price = num(o.price);
    if (!name) details.push({ path: `options[${idx}].name`, message: `Option ${idx + 1} needs a name` });
    if (price < 0) details.push({ path: `options[${idx}].price`, message: `${name || `Option ${idx + 1}`}: price can't be negative` });
    const key = name.toLowerCase();
    if (key && seen.has(key)) details.push({ path: `options[${idx}].name`, message: `${name} is listed twice` });
    seen.add(key);
    return {
      id: text(o.id) || crypto.randomUUID(),
      group_id: groupId,
      code: text(o.code),
      name,
      price,
      is_default: o.isDefault === true,
      sort_order: idx,
      status: status(o.status),
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length === 0) details.push({ path: "options", message: "Add at least one option to the group" });
  const defaults = rows.filter((r) => r.is_default && r.status === "Active").length;
  const cap = rules.selectionType === "single" ? 1 : rules.maxSelect;
  if (cap !== null && defaults > cap) {
    details.push({ path: "options", message: `Only ${cap} option${cap === 1 ? "" : "s"} can be pre-selected` });
  }
  return { rows, details };
}

async function writeOptions(groupId: string, rows: Record<string, unknown>[]) {
  const { data: existing, error } = await supabase.from(modifierTables.options).select("id").eq("group_id", groupId);
  if (error) throw new Error(error.message);
  const keep = new Set(rows.map((r) => String(r.id)));
  const removed = (existing ?? []).map((r) => String(r.id)).filter((id) => !keep.has(id));
  if (removed.length > 0) {
    const { error: delError } = await supabase.from(modifierTables.options).delete().in("id", removed);
    if (delError) throw new Error(delError.message);
  }
  const { error: upError } = await supabase.from(modifierTables.options).upsert(rows, { onConflict: "id" });
  if (upError) throwIfRlsError(upError.message);
}

async function writeMenuItems(groupId: string, raw: unknown) {
  if (!Array.isArray(raw)) return;
  const ids = [...new Set((raw as unknown[]).map(text).filter((id) => UUID_RE.test(id)))];
  const { error } = await supabase.from(modifierTables.itemGroups).delete().eq("group_id", groupId);
  if (error) throw new Error(error.message);
  if (ids.length === 0) return;
  const { data: current } = await supabase
    .from(modifierTables.itemGroups)
    .select("menu_item_id, sort_order")
    .in("menu_item_id", ids);
  const nextOrder = new Map<string, number>();
  for (const r of current ?? []) {
    const id = String(r.menu_item_id);
    nextOrder.set(id, Math.max(nextOrder.get(id) ?? 0, num(r.sort_order) + 1));
  }
  const { error: insError } = await supabase
    .from(modifierTables.itemGroups)
    .insert(ids.map((menuItemId) => ({ menu_item_id: menuItemId, group_id: groupId, sort_order: nextOrder.get(menuItemId) ?? 0 })));
  if (insError) throwIfRlsError(insError.message);
}

export async function saveGroup(id: string | null, body: Record<string, unknown>): Promise<ModifierGroup> {
  const prev = id ? await getRowById<GroupRow>(modifierTables.groups, id) : null;
  const groupId = id ?? crypto.randomUUID();
  const details: { path: string; message: string }[] = [];

  const name = body.name !== undefined ? text(body.name) : (prev?.name ?? "");
  if (!name) details.push({ path: "name", message: "Group name is required" });

  const { rules, details: ruleDetails } = buildRules(body, prev ? normalizeGroup(prev) : null);
  details.push(...ruleDetails);
  const { rows: optionRows, details: optionDetails } = buildOptions(groupId, body.options, rules);
  details.push(...optionDetails);
  if (!prev && !optionRows) details.push({ path: "options", message: "Add at least one option to the group" });

  if (optionRows) {
    const active = optionRows.filter((o) => o.status === "Active").length;
    if (rules.minSelect > active) {
      details.push({ path: "minSelect", message: `Minimum selection is ${rules.minSelect} but only ${active} active option${active === 1 ? "" : "s"}` });
    }
  }
  if (details.length > 0) throw new ValidationError(details.map((d) => d.message).join("; "), details);

  const header: Record<string, unknown> = {
    name,
    ...rules,
    updatedAt: new Date().toISOString(),
  };
  for (const key of ["code", "description"] as const) {
    if (body[key] !== undefined) header[key] = text(body[key]);
  }
  if (body.status !== undefined) header.status = status(body.status);
  if (body.sortOrder !== undefined) header.sortOrder = Math.floor(num(body.sortOrder));

  if (prev) await updateRow(modifierTables.groups, groupId, header);
  else await insertRow(modifierTables.groups, { ...header, id: groupId, status: header.status ?? "Active" });

  try {
    if (optionRows) await writeOptions(groupId, optionRows);
    await writeMenuItems(groupId, body.menuItemIds);
  } catch (e) {
    if (!prev) await deleteRow(modifierTables.groups, groupId);
    throw e;
  }
  return (await getGroup(groupId)) as ModifierGroup;
}

export async function deleteGroup(id: string) {
  await deleteRow(modifierTables.groups, id);
}

-- F&B Modifiers — groups with selection rules, options per group, groups linked to menu items,
-- and a priced snapshot of chosen modifiers on every order line.
-- Upgrades the flat placeholder tables (fb_modifier_groups / fb_modifiers) in place; existing rows are kept.
-- Prerequisites: food-beverages-schema.sql, fnb-menu-items-schema.sql, fb-pos-v2-schema.sql
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ── Groups: rules ────────────────────────────────────────────────────────────
alter table public.fb_modifier_groups alter column id set default gen_random_uuid()::text;
alter table public.fb_modifier_groups add column if not exists description text not null default '';
alter table public.fb_modifier_groups add column if not exists selection_type text not null default 'single';
alter table public.fb_modifier_groups add column if not exists sort_order integer not null default 0;
alter table public.fb_modifier_groups add column if not exists updated_at timestamptz not null default now();
alter table public.fb_modifier_groups alter column max_select drop default;
alter table public.fb_modifier_groups alter column min_select set default 0;
alter table public.fb_modifier_groups alter column is_required set default false;

-- Bring legacy rows in line with the rules below before adding the checks.
update public.fb_modifier_groups set min_select = coalesce(min_select, 0), is_required = coalesce(is_required, false);
update public.fb_modifier_groups set selection_type = case when coalesce(max_select, 1) = 1 then 'single' else 'multiple' end
  where selection_type not in ('single', 'multiple') or selection_type = 'single';
update public.fb_modifier_groups set max_select = 1, min_select = least(min_select, 1) where selection_type = 'single';
update public.fb_modifier_groups set min_select = greatest(min_select, 1) where is_required;
update public.fb_modifier_groups set min_select = 0 where not is_required;
update public.fb_modifier_groups set max_select = null where selection_type = 'multiple' and max_select is not null and max_select < 1;
update public.fb_modifier_groups set max_select = min_select where max_select is not null and max_select < min_select;

alter table public.fb_modifier_groups alter column min_select set not null;
alter table public.fb_modifier_groups alter column is_required set not null;

alter table public.fb_modifier_groups drop constraint if exists fb_modifier_groups_selection_type_check;
alter table public.fb_modifier_groups add constraint fb_modifier_groups_selection_type_check
  check (selection_type in ('single', 'multiple'));
-- Required groups need at least one pick; optional groups never force one. max_select null = no upper limit.
alter table public.fb_modifier_groups drop constraint if exists fb_modifier_groups_rules_check;
alter table public.fb_modifier_groups add constraint fb_modifier_groups_rules_check check (
  min_select >= 0
  and (is_required = (min_select >= 1))
  and (max_select is null or max_select >= greatest(min_select, 1))
  and (selection_type = 'multiple' or max_select = 1)
);

alter table public.fb_modifier_groups drop column if exists options_count;

-- ── Options: belong to one group ─────────────────────────────────────────────
alter table public.fb_modifiers alter column id set default gen_random_uuid()::text;
alter table public.fb_modifiers add column if not exists group_id text references public.fb_modifier_groups (id) on delete cascade;
alter table public.fb_modifiers add column if not exists is_default boolean not null default false;
alter table public.fb_modifiers add column if not exists sort_order integer not null default 0;
alter table public.fb_modifiers add column if not exists updated_at timestamptz not null default now();
update public.fb_modifiers set price = 0 where price is null or price < 0;

-- Link legacy options to their group by name.
update public.fb_modifiers m set group_id = g.id
  from public.fb_modifier_groups g
  where m.group_id is null and coalesce(m.group_name, '') <> '' and lower(trim(m.group_name)) = lower(trim(g.name));

-- Options that never had a group go into an optional "Add-ons" group so they stay visible.
do $$
declare
  addon_id text;
begin
  if exists (select 1 from public.fb_modifiers where group_id is null) then
    select id into addon_id from public.fb_modifier_groups where lower(name) = 'add-ons' limit 1;
    if addon_id is null then
      insert into public.fb_modifier_groups (code, name, description, selection_type, is_required, min_select, max_select, status)
      values ('MG-ADDON', 'Add-ons', 'Optional extras', 'multiple', false, 0, null, 'Active')
      returning id into addon_id;
    end if;
    update public.fb_modifiers set group_id = addon_id where group_id is null;
  end if;
end $$;

alter table public.fb_modifiers alter column group_id set not null;
alter table public.fb_modifiers alter column price set not null;
alter table public.fb_modifiers alter column price set default 0;
alter table public.fb_modifiers drop constraint if exists fb_modifiers_price_check;
alter table public.fb_modifiers add constraint fb_modifiers_price_check check (price >= 0);
alter table public.fb_modifiers drop column if exists group_name;
alter table public.fb_modifiers drop column if exists linked_items;

create index if not exists idx_fb_modifiers_group on public.fb_modifiers (group_id, sort_order);

-- ── Which groups apply to which menu items ───────────────────────────────────
create table if not exists public.fb_menu_item_modifier_groups (
  menu_item_id uuid not null references public.fnb_menu_items (id) on delete cascade,
  group_id text not null references public.fb_modifier_groups (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (menu_item_id, group_id)
);

create index if not exists idx_fb_menu_item_modifier_groups_group on public.fb_menu_item_modifier_groups (group_id);

-- ── Order lines: what was chosen and what it cost at the time ────────────────
-- unit_price = base_price + modifier_total; modifiers = [{groupId, groupName, modifierId, name, price}]
alter table public.fb_order_items add column if not exists base_price numeric;
alter table public.fb_order_items add column if not exists modifier_total numeric not null default 0;
alter table public.fb_order_items add column if not exists modifiers jsonb not null default '[]'::jsonb;
update public.fb_order_items set base_price = unit_price where base_price is null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['fb_modifier_groups', 'fb_modifiers', 'fb_menu_item_modifier_groups']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

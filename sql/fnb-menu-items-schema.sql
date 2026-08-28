-- F&B menu items + UUID masters (units, tax groups) for FK integrity
-- Prerequisites: fnb-menu-categories-schema.sql
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ========== UUID masters (replace legacy text-id fb_* tables) ==========
drop table if exists public.fb_units cascade;
drop table if exists public.fb_tax_groups cascade;

create table if not exists public.fnb_units (
  id uuid primary key default gen_random_uuid(),
  code varchar unique not null,
  name varchar not null,
  symbol varchar default '',
  unit_type varchar default 'Count',
  decimal_places integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fnb_tax_groups (
  id uuid primary key default gen_random_uuid(),
  code varchar unique not null,
  name varchar not null,
  description text default '',
  tax_codes text default '',
  total_rate numeric default 0,
  applies_to varchar default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== Menu items ==========
drop table if exists public.fb_menu_items cascade;

create table if not exists public.fnb_menu_items (
  id uuid primary key default gen_random_uuid(),
  item_code varchar unique not null,
  name varchar not null,
  description text,
  category_id uuid not null references public.fnb_menu_categories (id) on delete restrict,
  tax_group_id uuid references public.fnb_tax_groups (id) on delete set null,
  price numeric not null default 0,
  is_vegetarian boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fnb_menu_items_category on public.fnb_menu_items (category_id);
create index if not exists idx_fnb_menu_items_active on public.fnb_menu_items (is_active);
create index if not exists idx_fnb_menu_items_display_order on public.fnb_menu_items (display_order);

-- updated_at triggers
create or replace function public.fnb_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fnb_units_updated_at on public.fnb_units;
create trigger trg_fnb_units_updated_at
  before update on public.fnb_units
  for each row execute function public.fnb_set_updated_at();

drop trigger if exists trg_fnb_tax_groups_updated_at on public.fnb_tax_groups;
create trigger trg_fnb_tax_groups_updated_at
  before update on public.fnb_tax_groups
  for each row execute function public.fnb_set_updated_at();

drop trigger if exists trg_fnb_menu_items_updated_at on public.fnb_menu_items;
create trigger trg_fnb_menu_items_updated_at
  before update on public.fnb_menu_items
  for each row execute function public.fnb_set_updated_at();

-- RLS
do $$
declare
  t text;
begin
  foreach t in array array[
    'fnb_units','fnb_tax_groups','fnb_menu_items'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- Seed masters (fixed UUIDs)
insert into public.fnb_units (id, code, name, symbol, unit_type, decimal_places, is_active) values
  ('b2000001-0000-4000-8000-000000000001', 'KG', 'Kilogram', 'kg', 'Weight', 2, true),
  ('b2000001-0000-4000-8000-000000000002', 'LTR', 'Litre', 'L', 'Volume', 2, true),
  ('b2000001-0000-4000-8000-000000000003', 'PCS', 'Pieces', 'pcs', 'Count', 0, true)
on conflict (id) do nothing;

insert into public.fnb_tax_groups (id, code, name, description, tax_codes, total_rate, applies_to, is_active) values
  ('c2000001-0000-4000-8000-000000000001', 'TG-FOOD5', 'Food GST 5%', 'Standard food rate', 'CGST2.5,SGST2.5', 5, 'Food', true),
  ('c2000001-0000-4000-8000-000000000002', 'TG-LIQ18', 'Liquor GST 18%', 'Alcoholic beverages', 'CGST9,SGST9', 18, 'Liquor', true)
on conflict (id) do nothing;

-- Seed menu items (requires fnb_menu_categories seed from fnb-menu-categories-schema.sql)
insert into public.fnb_menu_items (
  id, item_code, name, description, category_id, tax_group_id, price,
  is_vegetarian, is_active, display_order
) values
  (
    'e3000001-0000-4000-8000-000000000001',
    'IT-BC01',
    'Butter Chicken',
    'Creamy tomato-based curry',
    'a1000001-0000-4000-8000-000000000002',
    'c2000001-0000-4000-8000-000000000001',
    420,
    false,
    true,
    1
  ),
  (
    'e3000001-0000-4000-8000-000000000002',
    'IT-PT01',
    'Paneer Tikka',
    'Grilled cottage cheese starter',
    'a1000001-0000-4000-8000-000000000001',
    'c2000001-0000-4000-8000-000000000001',
    320,
    true,
    true,
    2
  ),
  (
    'e3000001-0000-4000-8000-000000000003',
    'IT-FLS01',
    'Fresh Lime Soda',
    'House-made lime soda',
    'a1000001-0000-4000-8000-000000000003',
    'c2000001-0000-4000-8000-000000000001',
    120,
    true,
    true,
    3
  )
on conflict (id) do nothing;

notify pgrst, 'schema cache';

-- F&B Conversion: two layers
-- 1) Master: conversion items (BOM) — what makes a prepared item (dough, batter, gravy…)
-- 2) Stock: production batches — produce qty from a master; Complete moves on-hand.
-- Safe to re-run in Supabase SQL Editor.

begin;

-- Mark ingredients as raw or prepared (semi-finished).
alter table if exists public.fb_ingredients
  add column if not exists kind text not null default 'raw';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fb_ingredients_kind_check'
  ) then
    alter table public.fb_ingredients
      add constraint fb_ingredients_kind_check check (kind in ('raw', 'prepared'));
  end if;
end $$;

-- ——— Master: conversion items ———
create table if not exists public.fb_conversion_items (
  id text primary key,
  property_id text,
  code text not null default '',
  name text not null,
  output_ingredient_id text not null references public.fb_ingredients(id),
  -- Linked PS material so recipes can pick converted items and POS can deduct kitchen stock.
  ps_product_id text references public.ps_products(id),
  output_name text not null default '',
  yield_qty numeric not null default 1 check (yield_qty > 0),
  yield_uom text not null default 'Kg',
  notes text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fb_conversion_items
  add column if not exists ps_product_id text references public.ps_products(id);

create table if not exists public.fb_conversion_item_lines (
  id text primary key,
  property_id text,
  conversion_item_id text not null references public.fb_conversion_items(id) on delete cascade,
  line_no int not null default 1,
  ingredient_id text not null references public.fb_ingredients(id),
  ingredient_code text not null default '',
  ingredient_name text not null default '',
  qty numeric not null default 0 check (qty > 0),
  uom text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists fb_conversion_items_name_property_uidx
  on public.fb_conversion_items (property_id, lower(name))
  where coalesce(property_id, '') <> '';

create index if not exists fb_conversion_items_property_idx on public.fb_conversion_items (property_id);
create index if not exists fb_conversion_item_lines_item_idx on public.fb_conversion_item_lines (conversion_item_id);

-- ——— Stock: production batches ———
create table if not exists public.fb_conversions (
  id text primary key,
  property_id text,
  conversion_no text not null,
  conversion_date text not null default to_char(now(), 'YYYY-MM-DD'),
  conversion_item_id text references public.fb_conversion_items(id),
  output_ingredient_id text not null references public.fb_ingredients(id),
  output_name text not null default '',
  output_qty numeric not null default 0 check (output_qty > 0),
  output_uom text not null default '',
  notes text not null default '',
  status text not null default 'Draft' check (status in ('Draft', 'Completed', 'Cancelled')),
  completed_at timestamptz,
  completed_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fb_conversions
  add column if not exists conversion_item_id text references public.fb_conversion_items(id);

create table if not exists public.fb_conversion_lines (
  id text primary key,
  property_id text,
  conversion_id text not null references public.fb_conversions(id) on delete cascade,
  line_no int not null default 1,
  ingredient_id text not null references public.fb_ingredients(id),
  ingredient_code text not null default '',
  ingredient_name text not null default '',
  qty numeric not null default 0 check (qty > 0),
  uom text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists fb_conversions_no_property_uidx
  on public.fb_conversions (property_id, conversion_no)
  where coalesce(property_id, '') <> '';

create index if not exists fb_conversions_property_idx on public.fb_conversions (property_id);
create index if not exists fb_conversions_status_idx on public.fb_conversions (status);
create index if not exists fb_conversions_item_idx on public.fb_conversions (conversion_item_id);
create index if not exists fb_conversion_lines_conversion_idx on public.fb_conversion_lines (conversion_id);
create index if not exists fb_conversion_lines_property_idx on public.fb_conversion_lines (property_id);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fb_ingredients' and column_name = 'property_id'
  ) then
    update public.fb_conversion_items set property_id = 'prop-shaw-hotel' where property_id is null;
    update public.fb_conversion_item_lines set property_id = 'prop-shaw-hotel' where property_id is null;
    update public.fb_conversions set property_id = 'prop-shaw-hotel' where property_id is null;
    update public.fb_conversion_lines set property_id = 'prop-shaw-hotel' where property_id is null;
  end if;
end $$;

commit;

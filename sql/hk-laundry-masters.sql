-- Patch: laundry item + pricing masters for Housekeeping
-- Run once in Supabase SQL Editor
-- No seed data — add items/prices via Laundry Item Master & Laundry Pricing Master UIs

create extension if not exists pgcrypto;

create table if not exists public.hk_laundry_items (
  id text primary key default gen_random_uuid()::text,
  item_code text not null unique,
  name text not null,
  category text not null default 'Garment',
  description text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists hk_laundry_items_item_code_key
  on public.hk_laundry_items (item_code);

create table if not exists public.hk_laundry_pricing (
  id text primary key default gen_random_uuid()::text,
  item_id text not null references public.hk_laundry_items (id) on delete cascade,
  service_type text not null,
  unit_price numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (item_id, service_type)
);

create index if not exists hk_laundry_pricing_item_id_idx
  on public.hk_laundry_pricing (item_id);

create or replace function public.hk_laundry_masters_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hk_laundry_items_set_updated_at on public.hk_laundry_items;
create trigger trg_hk_laundry_items_set_updated_at
  before update on public.hk_laundry_items
  for each row
  execute function public.hk_laundry_masters_set_updated_at();

drop trigger if exists trg_hk_laundry_pricing_set_updated_at on public.hk_laundry_pricing;
create trigger trg_hk_laundry_pricing_set_updated_at
  before update on public.hk_laundry_pricing
  for each row
  execute function public.hk_laundry_masters_set_updated_at();

alter table public.hk_laundry_items enable row level security;
drop policy if exists "anon_all_hk_laundry_items" on public.hk_laundry_items;
create policy "anon_all_hk_laundry_items"
  on public.hk_laundry_items
  for all to anon
  using (true)
  with check (true);

alter table public.hk_laundry_pricing enable row level security;
drop policy if exists "anon_all_hk_laundry_pricing" on public.hk_laundry_pricing;
create policy "anon_all_hk_laundry_pricing"
  on public.hk_laundry_pricing
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

-- F&B menu categories (flat list, UUID PK)
-- Run once in Supabase SQL Editor.
-- Replaces legacy fb_menu_categories.

create extension if not exists pgcrypto;

-- Legacy table (text id, flat columns) — safe to drop if unused as FK target
drop table if exists public.fb_menu_categories cascade;

create table if not exists public.fnb_menu_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  code varchar unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.fnb_menu_categories_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fnb_menu_categories_updated_at on public.fnb_menu_categories;
create trigger trg_fnb_menu_categories_updated_at
  before update on public.fnb_menu_categories
  for each row
  execute function public.fnb_menu_categories_set_updated_at();

alter table public.fnb_menu_categories enable row level security;
drop policy if exists "anon_all_fnb_menu_categories" on public.fnb_menu_categories;
create policy "anon_all_fnb_menu_categories"
  on public.fnb_menu_categories
  for all
  to anon
  using (true)
  with check (true);

-- Seed (fixed UUIDs for stable item references)
insert into public.fnb_menu_categories (id, code, name, description, is_active)
values
  (
    'a1000001-0000-4000-8000-000000000001',
    'STAR',
    'Starters',
    'Appetizers and small plates',
    true
  ),
  (
    'a1000001-0000-4000-8000-000000000002',
    'MAIN',
    'Main Course',
    'Curries, grills, and mains',
    true
  ),
  (
    'a1000001-0000-4000-8000-000000000003',
    'BEV',
    'Beverages',
    'Hot and cold drinks',
    true
  ),
  (
    'a1000001-0000-4000-8000-000000000004',
    'DST',
    'Desserts',
    'Sweets and desserts',
    true
  ),
  (
    'a1000001-0000-4000-8000-000000000005',
    'VEG-STAR',
    'Vegetarian Starters',
    'Vegetarian appetizers',
    true
  )
on conflict (id) do nothing;

notify pgrst, 'schema cache';

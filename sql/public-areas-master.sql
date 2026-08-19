-- Patch: public_areas — slim HK master (inventory only; ops stay on hk_public_areas)
-- Run once in Supabase SQL Editor after housekeeping-schema.sql

create extension if not exists pgcrypto;

do $$
begin
  create type public.public_area_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.public_areas (
  id text primary key default gen_random_uuid()::text,
  area_code text not null unique,
  name text not null,
  area_type text not null default 'Lobby',
  location text,
  floor_number int,
  priority public.public_area_priority not null default 'MEDIUM',
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists public_areas_area_code_key
  on public.public_areas (area_code);

create or replace function public.public_areas_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_public_areas_set_updated_at on public.public_areas;

create trigger trg_public_areas_set_updated_at
  before update on public.public_areas
  for each row
  execute function public.public_areas_set_updated_at();

insert into public.public_areas (area_code, name, area_type, location, floor_number, priority, is_active)
values
  ('PA-LOBBY', 'Main Lobby & Reception', 'Lobby', 'Main Entrance Lobby', 0, 'HIGH', true),
  ('PA-REST', 'Restaurant Dining Area', 'Restaurant', 'Saffron Spice Restaurant', 0, 'HIGH', true),
  ('PA-WC', 'Lobby Washrooms', 'Washroom', 'Lobby Restroom Corridor', 0, 'URGENT', true)
on conflict (area_code) do nothing;

alter table public.public_areas enable row level security;
drop policy if exists "anon_all_public_areas" on public.public_areas;
create policy "anon_all_public_areas"
  on public.public_areas
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

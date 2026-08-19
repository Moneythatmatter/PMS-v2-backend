-- Patch: hk_rooms — slim ops table (status enum + room FK only)
-- Run once in Supabase SQL Editor after rooms-master-slim.sql
-- Requires: public.rooms, optional public.users
-- Safe to re-run: skips rebuild if room_id column already exists.

create extension if not exists pgcrypto;

do $$
begin
  create type public.hk_room_status as enum (
    'CLEAN',
    'DIRTY',
    'INSPECTING',
    'INSPECTED',
    'OUT_OF_SERVICE'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'hk_rooms'
      and column_name = 'room_id'
  ) then
    raise notice 'hk_rooms already slim — skipping table rebuild';
    return;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_rooms'
  ) then
    alter table public.hk_rooms rename to hk_rooms_legacy;
  end if;
end $$;

create table if not exists public.hk_rooms (
  id text primary key default gen_random_uuid()::text,
  room_id text not null unique references public.rooms(id) on delete cascade,
  status public.hk_room_status not null default 'DIRTY',
  assigned_to text,
  inspected_by text,
  last_cleaned_at timestamptz,
  last_inspected_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    alter table public.hk_rooms drop constraint if exists hk_rooms_assigned_to_fkey;
    alter table public.hk_rooms
      add constraint hk_rooms_assigned_to_fkey
      foreign key (assigned_to) references public.users(id) on delete set null;

    alter table public.hk_rooms drop constraint if exists hk_rooms_inspected_by_fkey;
    alter table public.hk_rooms
      add constraint hk_rooms_inspected_by_fkey
      foreign key (inspected_by) references public.users(id) on delete set null;
  end if;
exception
  when others then null;
end $$;

-- Migrate from legacy hk_rooms when present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_rooms_legacy'
  ) then
    insert into public.hk_rooms (
      id,
      room_id,
      status,
      notes,
      created_at,
      updated_at
    )
    select
      coalesce(nullif(trim(l.id), ''), gen_random_uuid()::text),
      resolved.room_id,
      case
        when coalesce(l.status, '') ilike '%out of%'
          or coalesce(l.status, '') ilike '%ooo%'
          or coalesce(l.hk_status, '') ilike '%oos%'
          then 'OUT_OF_SERVICE'::public.hk_room_status
        when coalesce(l.status, '') ilike '%inspection%'
          or coalesce(l.hk_status, '') = 'Cleaning'
          then 'INSPECTING'::public.hk_room_status
        when coalesce(l.hk_status, '') = 'Inspected'
          or coalesce(l.status, '') ilike '%ready%'
          then 'INSPECTED'::public.hk_room_status
        when coalesce(l.hk_status, '') = 'Dirty'
          or coalesce(l.status, '') ilike '%dirty%'
          then 'DIRTY'::public.hk_room_status
        else 'CLEAN'::public.hk_room_status
      end,
      nullif(trim(coalesce(l.remarks, '')), ''),
      coalesce(l.created_at, now()),
      coalesce(l.updated_at, now())
    from public.hk_rooms_legacy l
    cross join lateral (
      select coalesce(
        (select r.id from public.rooms r where r.id = l.room_ref_id limit 1),
        (select r.id from public.rooms r where r.room_no = l.room_no limit 1)
      ) as room_id
    ) resolved
    where resolved.room_id is not null
    on conflict (room_id) do nothing;

    drop table public.hk_rooms_legacy;
  end if;
end $$;

create or replace function public.hk_rooms_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hk_rooms_set_updated_at on public.hk_rooms;

create trigger trg_hk_rooms_set_updated_at
  before update on public.hk_rooms
  for each row
  execute function public.hk_rooms_set_updated_at();

alter table public.hk_rooms enable row level security;
drop policy if exists "anon_all_hk_rooms" on public.hk_rooms;
create policy "anon_all_hk_rooms"
  on public.hk_rooms
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

-- Patch: rooms master — inventory fields only (drop operational denormalized columns)
-- Adds: max_occupancy, bed_type, is_active, updated_at
-- Drops: guest_name, housekeeping, maintenance, checkout_date
-- Run once in Supabase SQL Editor.

alter table public.rooms add column if not exists max_occupancy int not null default 2;
alter table public.rooms add column if not exists bed_type text not null default 'Queen';
alter table public.rooms add column if not exists is_active boolean not null default true;
alter table public.rooms add column if not exists updated_at timestamptz default now();

-- Backfill max_occupancy from room_types when possible
update public.rooms r
set max_occupancy = rt.max_occupancy
from public.room_types rt
where rt.name = r.room_type
  and r.max_occupancy = 2;

alter table public.rooms drop column if exists guest_name;
alter table public.rooms drop column if exists housekeeping;
alter table public.rooms drop column if exists maintenance;
alter table public.rooms drop column if exists checkout_date;

create or replace function public.rooms_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rooms_set_updated_at on public.rooms;

create trigger trg_rooms_set_updated_at
  before update on public.rooms
  for each row
  execute function public.rooms_set_updated_at();

notify pgrst, 'schema cache';

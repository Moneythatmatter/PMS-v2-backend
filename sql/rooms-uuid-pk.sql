-- Patch: FO rooms — UUID primary key (room_no becomes unique business key)
-- Run once in Supabase SQL Editor AFTER reservations-normalize-refs-fix-fk.sql

-- 1. Add UUID id column and backfill
alter table public.rooms add column if not exists id text;

update public.rooms
set id = gen_random_uuid()::text
where id is null or trim(id) = '';

alter table public.rooms alter column id set not null;

-- 2. Drop FKs that depend on rooms_pkey BEFORE changing the PK
alter table public.reservations drop constraint if exists reservations_room_ref_id_fkey;
alter table public.hk_rooms drop constraint if exists hk_rooms_room_ref_id_fkey;

-- 3. Remap room_ref_id values: room number → rooms.id UUID
update public.reservations r
set room_ref_id = rm.id
from public.rooms rm
where r.room_ref_id is not null
  and trim(r.room_ref_id) <> ''
  and rm.room_no = r.room_ref_id
  and r.room_ref_id <> rm.id;

update public.reservations
set room_ref_id = null
where room_ref_id is not null
  and (
    trim(room_ref_id) = ''
    or upper(trim(room_ref_id)) in ('TBA', 'N/A', 'NA', 'UNASSIGNED', '-')
    or not exists (select 1 from public.rooms rm where rm.id = reservations.room_ref_id)
  );

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_rooms'
  ) then
    update public.hk_rooms h
    set room_ref_id = rm.id
    from public.rooms rm
    where h.room_ref_id is not null
      and trim(h.room_ref_id) <> ''
      and rm.room_no = h.room_ref_id
      and h.room_ref_id <> rm.id;

    update public.hk_rooms
    set room_ref_id = null
    where room_ref_id is not null
      and trim(room_ref_id) <> ''
      and not exists (select 1 from public.rooms rm where rm.id = hk_rooms.room_ref_id);
  end if;
end $$;

-- 4. Switch primary key from room_no → id (safe now — no dependent FKs)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.rooms'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) like '%room_no%'
  ) then
    alter table public.rooms drop constraint rooms_pkey;
  end if;
exception
  when undefined_object then null;
end $$;

alter table public.rooms drop constraint if exists rooms_pkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rooms'::regclass and contype = 'p'
  ) then
    alter table public.rooms add primary key (id);
  end if;
end $$;

create unique index if not exists rooms_room_no_key on public.rooms(room_no);

-- 5. Re-add FKs → rooms(id)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_room_ref_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_room_ref_id_fkey
      foreign key (room_ref_id) references public.rooms(id) on delete set null;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_rooms'
  ) and not exists (
    select 1 from pg_constraint where conname = 'hk_rooms_room_ref_id_fkey'
  ) then
    alter table public.hk_rooms
      add constraint hk_rooms_room_ref_id_fkey
      foreign key (room_ref_id) references public.rooms(id) on delete set null;
  end if;
end $$;

create index if not exists idx_rooms_room_no on public.rooms(room_no);

notify pgrst, 'schema cache';

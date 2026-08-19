-- Patch: guests — UUID primary keys (replaces legacy G-* / G-MIG-* ids)
-- Run once in Supabase SQL Editor after reservations-uuid-pk.sql

create extension if not exists pgcrypto;

-- 1. Build old_id → new_uuid map for non-UUID guest ids
create temporary table _guest_id_map (
  old_id text primary key,
  new_id text not null
) on commit drop;

insert into _guest_id_map (old_id, new_id)
select g.id, gen_random_uuid()::text
from public.guests g
where g.id is not null
  and g.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

do $$
begin
  if not exists (select 1 from _guest_id_map) then
    raise notice 'All guest ids are already UUIDs — nothing to do.';
  end if;
end $$;

-- 2. Drop FK constraints that reference guests(id)
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as child_table
    from pg_constraint c
    where c.confrelid = 'public.guests'::regclass
      and c.contype = 'f'
  loop
    execute format('alter table %s drop constraint %I', r.child_table, r.conname);
  end loop;
end $$;

-- 3. Rewrite child FK columns
update public.reservations r
set guest_id = m.new_id
from _guest_id_map m
where r.guest_id = m.old_id;

update public.guest_stay_history h
set guest_id = m.new_id
from _guest_id_map m
where h.guest_id = m.old_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'desk_activity' and column_name = 'guest_id'
  ) then
    update public.desk_activity d
    set guest_id = m.new_id
    from _guest_id_map m
    where d.guest_id = m.old_id;
  end if;
end $$;

-- 4. Replace guest primary keys
update public.guests g
set id = m.new_id
from _guest_id_map m
where g.id = m.old_id;

-- 5. Re-create FK constraints
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reservations'
  ) and not exists (
    select 1 from pg_constraint where conname = 'reservations_guest_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_guest_id_fkey
      foreign key (guest_id) references public.guests(id) on delete restrict;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'guest_stay_history'
  ) and not exists (
    select 1 from pg_constraint where conname = 'guest_stay_history_guest_id_fkey'
  ) then
    alter table public.guest_stay_history
      add constraint guest_stay_history_guest_id_fkey
      foreign key (guest_id) references public.guests(id) on delete cascade;
  end if;
end $$;

notify pgrst, 'schema cache';

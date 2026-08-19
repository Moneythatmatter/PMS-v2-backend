-- Patch: reservations — UUID primary keys (replaces legacy BK-* ids)
-- Run once in Supabase SQL Editor after rooms-uuid-pk.sql

create extension if not exists pgcrypto;

-- 1. Build old_id → new_uuid map for non-UUID reservation ids
create temporary table _reservation_id_map (
  old_id text primary key,
  new_id text not null
) on commit drop;

insert into _reservation_id_map (old_id, new_id)
select r.id, gen_random_uuid()::text
from public.reservations r
where r.id is not null
  and r.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Nothing to migrate
do $$
begin
  if not exists (select 1 from _reservation_id_map) then
    raise notice 'All reservation ids are already UUIDs — nothing to do.';
  end if;
end $$;

-- 2. Drop FK constraints that reference reservations(id)
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as child_table
    from pg_constraint c
    where c.confrelid = 'public.reservations'::regclass
      and c.contype = 'f'
  loop
    execute format('alter table %s drop constraint %I', r.child_table, r.conname);
  end loop;
end $$;

-- 3. Rewrite child FK columns
update public.folio_entries f
set reservation_id = m.new_id
from _reservation_id_map m
where f.reservation_id = m.old_id;

update public.payments p
set reservation_id = m.new_id
from _reservation_id_map m
where p.reservation_id = m.old_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'booking_id'
  ) then
    update public.invoices i
    set booking_id = m.new_id
    from _reservation_id_map m
    where i.booking_id = m.old_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'desk_activity' and column_name = 'reservation_id'
  ) then
    update public.desk_activity d
    set reservation_id = m.new_id
    from _reservation_id_map m
    where d.reservation_id = m.old_id;
  end if;
end $$;

-- 4. Replace reservation primary keys
update public.reservations r
set id = m.new_id
from _reservation_id_map m
where r.id = m.old_id;

-- 5. Re-create FK constraints
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'folio_entries'
  ) and not exists (
    select 1 from pg_constraint where conname = 'folio_entries_reservation_id_fkey'
  ) then
    alter table public.folio_entries
      add constraint folio_entries_reservation_id_fkey
      foreign key (reservation_id) references public.reservations(id) on delete set null;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payments'
  ) and not exists (
    select 1 from pg_constraint where conname = 'payments_reservation_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_reservation_id_fkey
      foreign key (reservation_id) references public.reservations(id) on delete set null;
  end if;
end $$;

notify pgrst, 'schema cache';

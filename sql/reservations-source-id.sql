-- Patch: booking_sources UUID PK + reservations.source_id FK (replaces source text)
-- Run once in Supabase SQL Editor after guests-uuid-pk.sql

create extension if not exists pgcrypto;

-- ── 1. booking_sources: BS-* → UUID ──
create temporary table _booking_source_id_map (
  old_id text primary key,
  new_id text not null
) on commit drop;

insert into _booking_source_id_map (old_id, new_id)
select bs.id, gen_random_uuid()::text
from public.booking_sources bs
where bs.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- No FKs point at booking_sources yet (source was plain text)
update public.booking_sources bs
set id = m.new_id
from _booking_source_id_map m
where bs.id = m.old_id;

-- ── 2. reservations: add source_id, backfill from source text ──
alter table public.reservations add column if not exists source_id text;

update public.reservations r
set source_id = bs.id
from public.booking_sources bs
where r.source_id is null
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'source'
  )
  and (
    lower(trim(bs.name)) = lower(trim(r.source))
    or lower(trim(bs.code)) = lower(trim(r.source))
    or (lower(trim(r.source)) in ('direct', 'website') and bs.code = 'WEB')
    or (lower(trim(r.source)) in ('walk-in', 'walkin') and bs.code = 'WALKIN')
    or (lower(trim(r.source)) = 'booking.com' and bs.code = 'BCOM')
    or (lower(trim(r.source)) = 'makemytrip' and bs.code = 'MMT')
  );

-- Default unmapped → Walk-in
update public.reservations r
set source_id = bs.id
from public.booking_sources bs
where r.source_id is null
  and bs.code = 'WALKIN';

alter table public.reservations drop column if exists source;

-- ── 3. FK source_id → booking_sources(id) ──
alter table public.reservations drop constraint if exists reservations_source_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_source_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_source_id_fkey
      foreign key (source_id) references public.booking_sources(id) on delete set null;
  end if;
end $$;

create index if not exists idx_reservations_source_id on public.reservations(source_id);

notify pgrst, 'schema cache';

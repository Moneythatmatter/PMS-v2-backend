-- Patch: link guest_requests + legacy housekeeping_requests to reservations (booking_id)
-- Run once in Supabase SQL Editor after guest-requests.sql

-- ── guest_requests (canonical HK guest services table) ──
alter table public.guest_requests
  add column if not exists booking_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'guest_requests_booking_id_fkey'
  ) then
    alter table public.guest_requests
      add constraint guest_requests_booking_id_fkey
      foreign key (booking_id) references public.reservations(id) on delete set null;
  end if;
exception
  when others then null;
end $$;

create index if not exists guest_requests_booking_id_idx
  on public.guest_requests (booking_id)
  where booking_id is not null;

-- Backfill from checked-in / in-house reservation for the same room
update public.guest_requests gr
set booking_id = match.reservation_id
from (
  select distinct on (gr2.id)
    gr2.id as guest_request_id,
    res.id as reservation_id
  from public.guest_requests gr2
  join public.reservations res on res.room_ref_id = gr2.room_id
  where gr2.booking_id is null
    and res.status in ('Checked In', 'In-House')
  order by gr2.id, res.created_at desc nulls last
) match
where gr.id = match.guest_request_id
  and gr.booking_id is null;

-- ── legacy housekeeping_requests (optional — for old rows still in Supabase) ──
alter table public.housekeeping_requests
  add column if not exists booking_id text;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'housekeeping_requests'
  ) and exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reservations'
  ) then
    update public.housekeeping_requests hr
    set booking_id = match.reservation_id
    from (
      select distinct on (hr2.id)
        hr2.id as request_id,
        res.id as reservation_id
      from public.housekeeping_requests hr2
      join public.rooms rm on rm.room_no = hr2.room or rm.id = hr2.room
      join public.reservations res on res.room_ref_id = rm.id
      where hr2.booking_id is null
        and res.status in ('Checked In', 'In-House')
      order by hr2.id, res.created_at desc nulls last
    ) match
    where hr.id = match.request_id
      and hr.booking_id is null;
  end if;
exception
  when others then null;
end $$;

notify pgrst, 'schema cache';

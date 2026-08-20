-- Patch: rooms master — drop operational status column (source of truth: hk_rooms.status)
-- Run once in Supabase SQL Editor after hk-rooms-slim.sql

-- Backfill hk_rooms for any FO room missing an ops row
insert into public.hk_rooms (room_id, status)
select
  r.id,
  case
    when coalesce(r.status, '') ilike '%block%' then 'OUT_OF_SERVICE'::public.hk_room_status
    when coalesce(r.status, '') ilike '%maint%' then 'INSPECTING'::public.hk_room_status
    when coalesce(r.status, '') ilike '%dirty%' then 'DIRTY'::public.hk_room_status
    when coalesce(r.status, '') ilike '%inspect%' then 'INSPECTING'::public.hk_room_status
    else 'CLEAN'::public.hk_room_status
  end
from public.rooms r
where not exists (
  select 1 from public.hk_rooms h where h.room_id = r.id
)
on conflict (room_id) do nothing;

drop index if exists public.idx_rooms_status;
alter table public.rooms drop column if exists status;

notify pgrst, 'schema cache';

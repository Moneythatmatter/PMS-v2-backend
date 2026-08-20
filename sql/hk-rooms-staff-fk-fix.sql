-- Patch: hk_rooms — drop users FK on assigned_to / inspected_by
-- HK assigns by hk_staff name (e.g. "Meena Kumari"), not users.id.
-- Run once in Supabase SQL Editor after hk-rooms-slim.sql

alter table public.hk_rooms
  drop constraint if exists hk_rooms_assigned_to_fkey;

alter table public.hk_rooms
  drop constraint if exists hk_rooms_inspected_by_fkey;

comment on column public.hk_rooms.assigned_to is
  'hk_staff.id or staff display name';

comment on column public.hk_rooms.inspected_by is
  'Supervisor id or display name';

notify pgrst, 'schema cache';

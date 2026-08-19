-- Patch: guest_requests — drop users FK on assigned_to / created_by
-- The HK UI assigns by hk_staff name (e.g. "Kiran Bala"), not users.id.
-- Run once in Supabase SQL Editor after guest-requests.sql

alter table public.guest_requests
  drop constraint if exists guest_requests_assigned_to_fkey;

alter table public.guest_requests
  drop constraint if exists guest_requests_created_by_fkey;

comment on column public.guest_requests.assigned_to is
  'hk_staff.id or staff display name';

comment on column public.guest_requests.created_by is
  'Operator id or display name';

notify pgrst, 'schema cache';

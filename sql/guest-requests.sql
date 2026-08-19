-- Patch: guest_requests — slim guest service requests (replaces legacy housekeeping_requests ops shape)
-- Run once in Supabase SQL Editor after reservations-uuid-pk.sql
-- booking_id → reservations.id (nullable)

create extension if not exists pgcrypto;

do $$
begin
  create type public.guest_request_type as enum (
    'AMENITY',
    'LINEN',
    'TOWELS',
    'CLEANING',
    'LAUNDRY',
    'MINIBAR',
    'MAINTENANCE',
    'ROOM_SERVICE',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.guest_request_status as enum (
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'guest_request_priority') then
    create type public.guest_request_priority as enum (
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT'
    );
  end if;
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.guest_requests_request_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.guest_requests (
  id text primary key default gen_random_uuid()::text,
  request_number text,
  room_id text not null references public.rooms(id) on delete cascade,
  booking_id text references public.reservations(id) on delete set null,
  request_type public.guest_request_type not null default 'OTHER',
  description text not null,
  status public.guest_request_status not null default 'PENDING',
  priority public.guest_request_priority not null default 'MEDIUM',
  assigned_to text,
  created_by text,
  requested_at timestamptz default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists guest_requests_request_number_key
  on public.guest_requests (request_number)
  where request_number is not null and trim(request_number) <> '';

create index if not exists guest_requests_room_id_idx on public.guest_requests (room_id);
create index if not exists guest_requests_booking_id_idx on public.guest_requests (booking_id)
  where booking_id is not null;
create index if not exists guest_requests_status_idx on public.guest_requests (status);

-- assigned_to / created_by store hk_staff.id or display name (no users FK)

create or replace function public.guest_requests_assign_request_number()
returns trigger
language plpgsql
as $$
begin
  if new.request_number is null or trim(new.request_number) = '' then
    new.request_number := 'GR-' || nextval('public.guest_requests_request_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guest_requests_assign_request_number on public.guest_requests;

create trigger trg_guest_requests_assign_request_number
  before insert on public.guest_requests
  for each row
  execute function public.guest_requests_assign_request_number();

create or replace function public.guest_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_guest_requests_set_updated_at on public.guest_requests;

create trigger trg_guest_requests_set_updated_at
  before update on public.guest_requests
  for each row
  execute function public.guest_requests_set_updated_at();

-- Migrate legacy housekeeping_requests when present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'housekeeping_requests'
  ) then
    insert into public.guest_requests (
      id,
      room_id,
      booking_id,
      request_type,
      description,
      status,
      priority,
      notes,
      requested_at,
      created_at,
      updated_at
    )
    select
      coalesce(nullif(trim(l.id), ''), gen_random_uuid()::text),
      resolved.room_id,
      (
        select res.id
        from public.reservations res
        where res.room_ref_id = resolved.room_id
          and res.status in ('Checked In', 'In-House')
        order by res.created_at desc nulls last
        limit 1
      ),
      case
        when coalesce(l.issue, '') ilike '%towel%' then 'TOWELS'::public.guest_request_type
        when coalesce(l.issue, '') ilike '%linen%' or coalesce(l.issue, '') ilike '%pillow%' or coalesce(l.issue, '') ilike '%blanket%'
          then 'LINEN'::public.guest_request_type
        when coalesce(l.issue, '') ilike '%clean%' then 'CLEANING'::public.guest_request_type
        when coalesce(l.issue, '') ilike '%laundry%' then 'LAUNDRY'::public.guest_request_type
        when coalesce(l.issue, '') ilike '%minibar%' then 'MINIBAR'::public.guest_request_type
        when coalesce(l.issue, '') ilike '%amen%' or coalesce(l.issue, '') ilike '%toiletries%'
          then 'AMENITY'::public.guest_request_type
        else 'OTHER'::public.guest_request_type
      end,
      coalesce(nullif(trim(l.issue), ''), 'Guest request'),
      case
        when coalesce(l.status, '') ilike '%complete%' then 'COMPLETED'::public.guest_request_status
        when coalesce(l.status, '') ilike '%progress%' then 'IN_PROGRESS'::public.guest_request_status
        when coalesce(l.assigned_staff, '') not in ('', '—') then 'ASSIGNED'::public.guest_request_status
        else 'PENDING'::public.guest_request_status
      end,
      case upper(coalesce(l.priority, 'MEDIUM'))
        when 'LOW' then 'LOW'::public.guest_request_priority
        when 'HIGH' then 'HIGH'::public.guest_request_priority
        when 'URGENT' then 'URGENT'::public.guest_request_priority
        else 'MEDIUM'::public.guest_request_priority
      end,
      nullif(trim(concat_ws(' · ', nullif(trim(l.guest), ''), nullif(trim(l.created_at_label), ''))), ''),
      coalesce(l.created_at, now()),
      coalesce(l.created_at, now()),
      coalesce(l.created_at, now())
    from public.housekeeping_requests l
    cross join lateral (
      select coalesce(
        (select r.id from public.rooms r where r.room_no = l.room limit 1),
        (select r.id from public.rooms r where r.id = l.room limit 1)
      ) as room_id
    ) resolved
    where resolved.room_id is not null
    on conflict (id) do nothing;
  end if;
end $$;

alter table public.guest_requests enable row level security;
drop policy if exists "anon_all_guest_requests" on public.guest_requests;
create policy "anon_all_guest_requests"
  on public.guest_requests
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

-- Drop legacy users FK (HK UI uses hk_staff names/ids, not users.id)
alter table public.guest_requests
  drop constraint if exists guest_requests_assigned_to_fkey;

alter table public.guest_requests
  drop constraint if exists guest_requests_created_by_fkey;

notify pgrst, 'schema cache';

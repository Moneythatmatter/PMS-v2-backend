-- Patch: maintenance_requests — slim engineering work orders (replaces legacy FO shape)
-- Run once in Supabase SQL Editor after public-areas-master.sql
-- room_id → rooms.id (nullable) · public_area_id → public_areas.id (nullable)

create extension if not exists pgcrypto;

-- Rename legacy table when old columns still present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'maintenance_requests'
      and column_name = 'room'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'maintenance_requests'
      and column_name = 'room_id'
  ) then
    alter table public.maintenance_requests rename to maintenance_requests_legacy;
  end if;
end $$;

do $$
begin
  create type public.maintenance_issue_type as enum (
    'ELECTRICAL',
    'PLUMBING',
    'HVAC',
    'CARPENTRY',
    'CIVIL',
    'APPLIANCE',
    'IT',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.maintenance_request_status as enum (
    'OPEN',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_VERIFICATION',
    'CLOSED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.maintenance_request_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.maintenance_requests_request_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.maintenance_requests (
  id text primary key default gen_random_uuid()::text,
  request_number text,
  room_id text references public.rooms(id) on delete set null,
  public_area_id text references public.public_areas(id) on delete set null,
  issue_type public.maintenance_issue_type not null default 'OTHER',
  title text not null,
  description text not null,
  priority public.maintenance_request_priority not null default 'MEDIUM',
  status public.maintenance_request_status not null default 'OPEN',
  reported_by text,
  assigned_to text,
  reported_at timestamptz default now(),
  assigned_at timestamptz,
  started_at timestamptz,
  estimated_completion_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  resolution text,
  notes text,
  blocks_room boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint maintenance_requests_location_chk check (
    room_id is not null or public_area_id is not null
  )
);

create unique index if not exists maintenance_requests_request_number_key
  on public.maintenance_requests (request_number)
  where request_number is not null and trim(request_number) <> '';

create index if not exists maintenance_requests_room_id_idx
  on public.maintenance_requests (room_id)
  where room_id is not null;

create index if not exists maintenance_requests_public_area_id_idx
  on public.maintenance_requests (public_area_id)
  where public_area_id is not null;

create index if not exists maintenance_requests_status_idx
  on public.maintenance_requests (status);

-- reported_by / assigned_to / verified_by store hk_staff.id or display name (no users FK)

create or replace function public.maintenance_requests_assign_request_number()
returns trigger
language plpgsql
as $$
begin
  if new.request_number is null or trim(new.request_number) = '' then
    new.request_number := 'MR-' || nextval('public.maintenance_requests_request_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_maintenance_requests_assign_request_number on public.maintenance_requests;

create trigger trg_maintenance_requests_assign_request_number
  before insert on public.maintenance_requests
  for each row
  execute function public.maintenance_requests_assign_request_number();

create or replace function public.maintenance_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_maintenance_requests_set_updated_at on public.maintenance_requests;

create trigger trg_maintenance_requests_set_updated_at
  before update on public.maintenance_requests
  for each row
  execute function public.maintenance_requests_set_updated_at();

-- Migrate legacy maintenance_requests when present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'maintenance_requests_legacy'
  ) then
    insert into public.maintenance_requests (
      id,
      room_id,
      issue_type,
      title,
      description,
      priority,
      status,
      reported_by,
      assigned_to,
      reported_at,
      assigned_at,
      started_at,
      completed_at,
      notes,
      blocks_room,
      created_at,
      updated_at
    )
    select
      coalesce(nullif(trim(l.id), ''), gen_random_uuid()::text),
      resolved.room_id,
      case
        when coalesce(l.problem, '') ilike '%elect%' then 'ELECTRICAL'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%plumb%' or coalesce(l.problem, '') ilike '%leak%'
          then 'PLUMBING'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%ac %' or coalesce(l.problem, '') ilike '%air cond%' or coalesce(l.problem, '') ilike '%hvac%'
          then 'HVAC'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%furn%' or coalesce(l.problem, '') ilike '%carpent%'
          then 'CARPENTRY'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%paint%' or coalesce(l.problem, '') ilike '%door%' or coalesce(l.problem, '') ilike '%window%'
          then 'CIVIL'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%tv%' or coalesce(l.problem, '') ilike '%television%'
          then 'IT'::public.maintenance_issue_type
        when coalesce(l.problem, '') ilike '%appliance%'
          then 'APPLIANCE'::public.maintenance_issue_type
        else 'OTHER'::public.maintenance_issue_type
      end,
      coalesce(
        nullif(trim(split_part(l.problem, ' — ', 1)), ''),
        nullif(trim(split_part(l.problem, ' - ', 1)), ''),
        'Maintenance'
      ),
      coalesce(
        nullif(trim(split_part(l.problem, ' — ', 2)), ''),
        nullif(trim(split_part(l.problem, ' - ', 2)), ''),
        nullif(trim(l.problem), ''),
        'Maintenance issue'
      ),
      case upper(coalesce(l.priority, 'MEDIUM'))
        when 'LOW' then 'LOW'::public.maintenance_request_priority
        when 'HIGH' then 'HIGH'::public.maintenance_request_priority
        when 'CRITICAL' then 'CRITICAL'::public.maintenance_request_priority
        else 'MEDIUM'::public.maintenance_request_priority
      end,
      case
        when coalesce(l.status, '') ilike '%closed%' then 'CLOSED'::public.maintenance_request_status
        when coalesce(l.status, '') ilike '%await%verif%' then 'AWAITING_VERIFICATION'::public.maintenance_request_status
        when coalesce(l.status, '') ilike '%progress%' then 'IN_PROGRESS'::public.maintenance_request_status
        when coalesce(l.status, '') ilike '%assign%' then 'ASSIGNED'::public.maintenance_request_status
        when coalesce(l.status, '') ilike '%cancel%' then 'CANCELLED'::public.maintenance_request_status
        when coalesce(l.engineer, '') not in ('', '—') then 'ASSIGNED'::public.maintenance_request_status
        else 'OPEN'::public.maintenance_request_status
      end,
      nullif(trim(l.reported_by), ''),
      nullif(trim(l.engineer), ''),
      coalesce(l.created_at, now()),
      case when nullif(trim(l.assigned_at), '') is not null then l.created_at else null end,
      case when nullif(trim(l.started_at), '') is not null then l.created_at else null end,
      case when nullif(trim(l.completed_at), '') is not null then l.created_at else null end,
      nullif(trim(concat_ws(' · ', nullif(trim(l.assignment_type), ''), nullif(trim(l.estimated_completion), ''))), ''),
      upper(coalesce(l.priority, '')) in ('HIGH', 'CRITICAL'),
      coalesce(l.created_at, now()),
      coalesce(l.created_at, now())
    from public.maintenance_requests_legacy l
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

alter table public.maintenance_requests enable row level security;
drop policy if exists "anon_all_maintenance_requests" on public.maintenance_requests;
create policy "anon_all_maintenance_requests"
  on public.maintenance_requests
  for all to anon
  using (true)
  with check (true);

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_assigned_to_fkey;

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_reported_by_fkey;

alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_verified_by_fkey;

notify pgrst, 'schema cache';

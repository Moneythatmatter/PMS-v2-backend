-- Patch: damage_reports — slim asset damage / recovery workflow
-- Run once in Supabase SQL Editor after front-office-schema.sql
-- room_id → rooms.id · booking_id → reservations.id · guest_id → guests.id
-- asset_id is optional text (no assets master yet) · reported_by → users.id

create extension if not exists pgcrypto;

-- Rename legacy hk table when old shape still present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_damage_reports'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'damage_reports'
  ) then
    alter table public.hk_damage_reports rename to hk_damage_reports_legacy;
  end if;
end $$;

do $$
begin
  create type public.damage_type as enum (
    'ELECTRICAL',
    'PLUMBING',
    'HVAC',
    'FURNITURE',
    'WALL',
    'LINEN',
    'GLASS',
    'FLOORING',
    'EQUIPMENT',
    'ELECTRONICS',
    'BATHROOM',
    'DECOR',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.damage_severity as enum (
    'CRITICAL',
    'MAJOR',
    'MODERATE',
    'MINOR'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.damage_responsibility as enum (
    'GUEST',
    'HOTEL',
    'NATURAL_WEAR',
    'VENDOR',
    'SPLIT'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.damage_report_status as enum (
    'REPORTED',
    'UNDER_REVIEW',
    'PENDING_FINANCE',
    'PENDING_ENGINEERING',
    'INSURANCE_CLAIM',
    'REPAIRED',
    'RECOVERED',
    'CLOSED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.damage_reports_report_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.damage_reports (
  id text primary key default gen_random_uuid()::text,
  report_number text,
  room_id text references public.rooms(id) on delete set null,
  booking_id text references public.reservations(id) on delete set null,
  guest_id text references public.guests(id) on delete set null,
  asset_id text,
  reported_by text references public.users(id) on delete set null,
  damage_type public.damage_type not null default 'OTHER',
  severity public.damage_severity not null default 'MODERATE',
  responsibility public.damage_responsibility not null default 'HOTEL',
  description text not null default '',
  estimated_cost numeric not null default 0,
  actual_cost numeric,
  status public.damage_report_status not null default 'REPORTED',
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists damage_reports_report_number_key
  on public.damage_reports (report_number)
  where report_number is not null and trim(report_number) <> '';

create index if not exists damage_reports_room_id_idx
  on public.damage_reports (room_id)
  where room_id is not null;

create index if not exists damage_reports_booking_id_idx
  on public.damage_reports (booking_id)
  where booking_id is not null;

create index if not exists damage_reports_guest_id_idx
  on public.damage_reports (guest_id)
  where guest_id is not null;

create index if not exists damage_reports_status_idx
  on public.damage_reports (status);

create index if not exists damage_reports_reported_at_idx
  on public.damage_reports (reported_at desc);

create or replace function public.damage_reports_assign_report_number()
returns trigger
language plpgsql
as $$
begin
  if new.report_number is null or trim(new.report_number) = '' then
    new.report_number := 'DM-' || nextval('public.damage_reports_report_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_damage_reports_assign_report_number on public.damage_reports;

create trigger trg_damage_reports_assign_report_number
  before insert on public.damage_reports
  for each row
  execute function public.damage_reports_assign_report_number();

create or replace function public.damage_reports_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_damage_reports_set_updated_at on public.damage_reports;

create trigger trg_damage_reports_set_updated_at
  before update on public.damage_reports
  for each row
  execute function public.damage_reports_set_updated_at();

-- Migrate legacy hk_damage_reports when present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'hk_damage_reports_legacy'
  ) then
    insert into public.damage_reports (
      id,
      report_number,
      room_id,
      reported_by,
      damage_type,
      severity,
      responsibility,
      description,
      estimated_cost,
      status,
      reported_at,
      notes,
      created_at,
      updated_at
    )
    select
      coalesce(nullif(trim(l.id), ''), gen_random_uuid()::text),
      case
        when l.id ~* '^DM-' then l.id
        else null
      end,
      resolved.room_id,
      resolved.reported_by_user_id,
      coalesce(resolved.damage_type, 'OTHER'::public.damage_type),
      'MODERATE'::public.damage_severity,
      'HOTEL'::public.damage_responsibility,
      coalesce(nullif(trim(l.description), ''), 'Damage reported'),
      coalesce(l.estimated_cost, 0),
      case
        when coalesce(l.status, '') ilike '%cancel%' then 'CANCELLED'::public.damage_report_status
        when coalesce(l.status, '') ilike '%repair%' then 'REPAIRED'::public.damage_report_status
        when coalesce(l.status, '') ilike '%approv%' then 'UNDER_REVIEW'::public.damage_report_status
        when coalesce(l.status, '') ilike '%close%' then 'CLOSED'::public.damage_report_status
        else 'REPORTED'::public.damage_report_status
      end,
      coalesce(
        case
          when l.reported_at ~ '^\d{4}-\d{2}-\d{2}' then l.reported_at::timestamptz
          else null
        end,
        l.created_at,
        now()
      ),
      nullif(trim(l.photo), ''),
      coalesce(l.created_at, now()),
      coalesce(l.created_at, now())
    from public.hk_damage_reports_legacy l
    cross join lateral (
      select
        coalesce(
          (select r.id from public.rooms r where r.room_no = l.room limit 1),
          (select r.id from public.rooms r where r.id = l.room limit 1)
        ) as room_id,
        (
          select u.id
          from public.users u
          where u.id = nullif(trim(l.reported_by), '')
             or lower(trim(u.name)) = lower(trim(l.reported_by))
          limit 1
        ) as reported_by_user_id,
        case
          when coalesce(l.damage_type, '') ilike '%elect%' then 'ELECTRICAL'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%plumb%' then 'PLUMBING'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%ac%' or coalesce(l.damage_type, '') ilike '%hvac%' then 'HVAC'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%furn%' then 'FURNITURE'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%wall%' then 'WALL'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%linen%' then 'LINEN'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%glass%' then 'GLASS'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%floor%' then 'FLOORING'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%equip%' then 'EQUIPMENT'::public.damage_type
          when coalesce(l.damage_type, '') ilike '%electron%' then 'ELECTRONICS'::public.damage_type
          else 'OTHER'::public.damage_type
        end as damage_type
    ) resolved
    on conflict (id) do nothing;
  end if;
end $$;

alter table public.damage_reports enable row level security;

drop policy if exists "anon_all_damage_reports" on public.damage_reports;
create policy "anon_all_damage_reports"
  on public.damage_reports
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

-- Patch: housekeeping_tasks — task queue for room cleaning / inspection
-- Run once in Supabase SQL Editor after hk-rooms-slim.sql
-- booking_id → reservations.id (nullable for vacant-room deep cleans)

create extension if not exists pgcrypto;

do $$
begin
  create type public.hk_task_type as enum (
    'CHECKOUT_CLEANING',
    'REGULAR_CLEANING',
    'DEEP_CLEANING',
    'INSPECTION',
    'TURNDOWN',
    'SPECIAL_REQUEST'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hk_task_status as enum (
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'APPROVED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hk_task_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.housekeeping_tasks_task_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.housekeeping_tasks (
  id text primary key default gen_random_uuid()::text,
  task_number text,
  room_id text not null references public.rooms(id) on delete cascade,
  booking_id text references public.reservations(id) on delete set null,
  task_type public.hk_task_type not null default 'REGULAR_CLEANING',
  status public.hk_task_status not null default 'PENDING',
  assigned_to text,
  created_by text,
  priority public.hk_task_priority not null default 'MEDIUM',
  notes text,
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists housekeeping_tasks_task_number_key
  on public.housekeeping_tasks (task_number)
  where task_number is not null and trim(task_number) <> '';

create index if not exists housekeeping_tasks_room_id_idx
  on public.housekeeping_tasks (room_id);

create index if not exists housekeeping_tasks_booking_id_idx
  on public.housekeeping_tasks (booking_id)
  where booking_id is not null;

create index if not exists housekeeping_tasks_status_idx
  on public.housekeeping_tasks (status);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    alter table public.housekeeping_tasks
      drop constraint if exists housekeeping_tasks_assigned_to_fkey;
    alter table public.housekeeping_tasks
      add constraint housekeeping_tasks_assigned_to_fkey
      foreign key (assigned_to) references public.users(id) on delete set null;

    alter table public.housekeeping_tasks
      drop constraint if exists housekeeping_tasks_created_by_fkey;
    alter table public.housekeeping_tasks
      add constraint housekeeping_tasks_created_by_fkey
      foreign key (created_by) references public.users(id) on delete set null;

    alter table public.housekeeping_tasks
      drop constraint if exists housekeeping_tasks_approved_by_fkey;
    alter table public.housekeeping_tasks
      add constraint housekeeping_tasks_approved_by_fkey
      foreign key (approved_by) references public.users(id) on delete set null;
  end if;
exception
  when others then null;
end $$;

create or replace function public.housekeeping_tasks_assign_task_number()
returns trigger
language plpgsql
as $$
begin
  if new.task_number is null or trim(new.task_number) = '' then
    new.task_number := 'HT-' || nextval('public.housekeeping_tasks_task_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_housekeeping_tasks_assign_task_number on public.housekeeping_tasks;

create trigger trg_housekeeping_tasks_assign_task_number
  before insert on public.housekeeping_tasks
  for each row
  execute function public.housekeeping_tasks_assign_task_number();

create or replace function public.housekeeping_tasks_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_housekeeping_tasks_set_updated_at on public.housekeeping_tasks;

create trigger trg_housekeeping_tasks_set_updated_at
  before update on public.housekeeping_tasks
  for each row
  execute function public.housekeeping_tasks_set_updated_at();

-- Mark FO hk_rooms dirty and ensure a row exists for the room.
create or replace function public.hk_ensure_room_dirty(p_room_id text)
returns void
language plpgsql
as $$
begin
  if p_room_id is null or trim(p_room_id) = '' then
    return;
  end if;

  insert into public.hk_rooms (room_id, status)
  values (p_room_id, 'DIRTY'::public.hk_room_status)
  on conflict (room_id) do update
    set status = 'DIRTY'::public.hk_room_status,
        updated_at = now();
end;
$$;

-- Checkout hook: DIRTY room + PENDING CHECKOUT_CLEANING task (idempotent per booking).
create or replace function public.hk_create_checkout_task(
  p_room_id text,
  p_booking_id text,
  p_notes text default null,
  p_created_by text default null
)
returns text
language plpgsql
as $$
declare
  v_task_id text;
begin
  if p_room_id is null or trim(p_room_id) = '' then
    return null;
  end if;

  perform public.hk_ensure_room_dirty(p_room_id);

  if p_booking_id is not null and trim(p_booking_id) <> '' then
    select id into v_task_id
    from public.housekeeping_tasks
    where booking_id = p_booking_id
      and task_type = 'CHECKOUT_CLEANING'::public.hk_task_type
      and status not in ('APPROVED'::public.hk_task_status, 'CANCELLED'::public.hk_task_status)
    limit 1;

    if v_task_id is not null then
      return v_task_id;
    end if;
  end if;

  insert into public.housekeeping_tasks (
    room_id,
    booking_id,
    task_type,
    status,
    priority,
    notes,
    created_by
  ) values (
    p_room_id,
    nullif(trim(coalesce(p_booking_id, '')), ''),
    'CHECKOUT_CLEANING'::public.hk_task_type,
    'PENDING'::public.hk_task_status,
    'HIGH'::public.hk_task_priority,
    coalesce(
      nullif(trim(coalesce(p_notes, '')), ''),
      'Auto-created on guest checkout'
    ),
    nullif(trim(coalesce(p_created_by, '')), '')
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

-- RLS (anon full access — same as other HK tables)
alter table public.housekeeping_tasks enable row level security;
drop policy if exists "anon_all_housekeeping_tasks" on public.housekeeping_tasks;
create policy "anon_all_housekeeping_tasks"
  on public.housekeeping_tasks
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

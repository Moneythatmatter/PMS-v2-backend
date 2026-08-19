-- Patch: lost_found_items — slim custody / claim workflow
-- Run once in Supabase SQL Editor after front-office-schema.sql
-- booking_id → reservations.id (bookings) · room_id → rooms.id · guest_id → guests.id

create extension if not exists pgcrypto;

-- Rename legacy table when old columns still present
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lost_found_items'
      and column_name = 'item'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lost_found_items'
      and column_name = 'item_name'
  ) then
    alter table public.lost_found_items rename to lost_found_items_legacy;
  end if;
end $$;

do $$
begin
  create type public.lost_found_category as enum (
    'ELECTRONICS',
    'JEWELRY',
    'CLOTHING',
    'DOCUMENTS',
    'CASH',
    'BAGS',
    'ACCESSORIES',
    'MEDICINE',
    'KEYS',
    'PERSONAL_ITEMS',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.lost_found_status as enum (
    'STORED',
    'AWAITING_CLAIM',
    'UNDER_VERIFICATION',
    'CLAIMED',
    'RETURNED',
    'DISPOSED',
    'COURIER_DISPATCHED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.lost_found_return_method as enum (
    'IN_PERSON',
    'COURIER',
    'AUTHORIZED_PICKUP',
    'MAILED',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.lost_found_items_item_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.lost_found_items (
  id text primary key default gen_random_uuid()::text,
  item_number text,
  room_id text references public.rooms(id) on delete set null,
  booking_id text references public.reservations(id) on delete set null,
  guest_id text references public.guests(id) on delete set null,
  item_name text not null,
  description text,
  category public.lost_found_category not null default 'OTHER',
  found_location text not null default '',
  found_by text references public.users(id) on delete set null,
  found_at timestamptz not null default now(),
  status public.lost_found_status not null default 'STORED',
  stored_location text,
  claimed_by text references public.guests(id) on delete set null,
  claimed_at timestamptz,
  returned_to text,
  return_method public.lost_found_return_method,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lost_found_items_item_number_key
  on public.lost_found_items (item_number)
  where item_number is not null and trim(item_number) <> '';

create index if not exists lost_found_items_room_id_idx
  on public.lost_found_items (room_id)
  where room_id is not null;

create index if not exists lost_found_items_booking_id_idx
  on public.lost_found_items (booking_id)
  where booking_id is not null;

create index if not exists lost_found_items_guest_id_idx
  on public.lost_found_items (guest_id)
  where guest_id is not null;

create index if not exists lost_found_items_status_idx
  on public.lost_found_items (status);

create index if not exists lost_found_items_found_at_idx
  on public.lost_found_items (found_at desc);

create or replace function public.lost_found_items_assign_item_number()
returns trigger
language plpgsql
as $$
begin
  if new.item_number is null or trim(new.item_number) = '' then
    new.item_number := 'LF-' || nextval('public.lost_found_items_item_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lost_found_items_assign_item_number on public.lost_found_items;

create trigger trg_lost_found_items_assign_item_number
  before insert on public.lost_found_items
  for each row
  execute function public.lost_found_items_assign_item_number();

create or replace function public.lost_found_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lost_found_items_set_updated_at on public.lost_found_items;

create trigger trg_lost_found_items_set_updated_at
  before update on public.lost_found_items
  for each row
  execute function public.lost_found_items_set_updated_at();

-- Migrate legacy lost_found_items when present
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lost_found_items_legacy'
  ) then
    insert into public.lost_found_items (
      id,
      item_number,
      room_id,
      guest_id,
      item_name,
      description,
      category,
      found_location,
      found_by,
      found_at,
      status,
      stored_location,
      claimed_at,
      returned_to,
      notes,
      created_at,
      updated_at
    )
    select
      coalesce(nullif(trim(l.id), ''), gen_random_uuid()::text),
      case
        when l.id ~* '^LF-' then l.id
        else null
      end,
      resolved.room_id,
      resolved.guest_id,
      coalesce(nullif(trim(l.item), ''), 'Unnamed item'),
      nullif(trim(l.description), ''),
      'OTHER'::public.lost_found_category,
      coalesce(nullif(trim(l.room), ''), 'Unknown'),
      resolved.found_by_user_id,
      coalesce(
        case
          when l.found_date ~ '^\d{4}-\d{2}-\d{2}' then l.found_date::timestamptz
          else null
        end,
        l.created_at,
        now()
      ),
      case
        when coalesce(l.status, '') ilike '%return%' then 'RETURNED'::public.lost_found_status
        when coalesce(l.status, '') ilike '%claim%' then 'CLAIMED'::public.lost_found_status
        when coalesce(l.status, '') ilike '%courier%' then 'COURIER_DISPATCHED'::public.lost_found_status
        when coalesce(l.status, '') ilike '%verif%' then 'UNDER_VERIFICATION'::public.lost_found_status
        when coalesce(l.status, '') ilike '%await%' then 'AWAITING_CLAIM'::public.lost_found_status
        else 'STORED'::public.lost_found_status
      end,
      null,
      case
        when nullif(trim(l.returned_date), '') is not null then
          coalesce(l.created_at, now())
        else null
      end,
      nullif(trim(l.guest), ''),
      null,
      coalesce(l.created_at, now()),
      coalesce(l.created_at, now())
    from public.lost_found_items_legacy l
    cross join lateral (
      select
        coalesce(
          (select r.id from public.rooms r where r.room_no = l.room limit 1),
          (select r.id from public.rooms r where r.id = l.room limit 1)
        ) as room_id,
        (
          select g.id
          from public.guests g
          where lower(trim(g.name)) = lower(trim(l.guest))
          limit 1
        ) as guest_id,
        (
          select u.id
          from public.users u
          where u.id = nullif(trim(l.found_by), '')
             or lower(trim(u.name)) = lower(trim(l.found_by))
          limit 1
        ) as found_by_user_id
    ) resolved
    on conflict (id) do nothing;
  end if;
end $$;

alter table public.lost_found_items enable row level security;

drop policy if exists "anon_all_lost_found_items" on public.lost_found_items;
create policy "anon_all_lost_found_items"
  on public.lost_found_items
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'schema cache';

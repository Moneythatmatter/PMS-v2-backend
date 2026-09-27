-- Reservation ↔ guests (primary + companions on a booking)
-- Run once in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.reservation_guests (
  id text primary key default gen_random_uuid()::text,
  property_id text,
  reservation_id text not null references public.reservations(id) on delete cascade,
  guest_id text not null references public.guests(id) on delete restrict,
  role text not null default 'COMPANION'
    check (role in ('PRIMARY', 'COMPANION')),
  created_at timestamptz not null default now(),
  unique (reservation_id, guest_id)
);

create index if not exists reservation_guests_reservation_id_idx
  on public.reservation_guests (reservation_id);

create index if not exists reservation_guests_guest_id_idx
  on public.reservation_guests (guest_id);

-- Backfill primary guest from reservations.guest_id
insert into public.reservation_guests (property_id, reservation_id, guest_id, role)
select
  r.property_id,
  r.id,
  r.guest_id,
  'PRIMARY'
from public.reservations r
where r.guest_id is not null
  and not exists (
    select 1
    from public.reservation_guests rg
    where rg.reservation_id = r.id
      and rg.guest_id = r.guest_id
  )
on conflict (reservation_id, guest_id) do nothing;

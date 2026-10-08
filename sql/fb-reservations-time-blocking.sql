-- F&B table reservations — dated bookings with a dining duration and time-based table blocking.
-- A table is only held from (start − buffer) until (start + grace); outside that window it is free for walk-ins.
-- Reservation status (Confirmed → Seated → Completed / No Show / Cancelled) is kept apart from the physical
-- table state, which still comes from sessions, orders and bills.
-- Prerequisites: food-beverages-schema.sql, fb-pos-v2-schema.sql
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ── Settings: global row + optional per-outlet overrides ─────────────────────
create table if not exists public.fb_reservation_settings (
  scope_key text primary key,               -- 'global' or an fb_outlets.id
  buffer_before_min integer not null default 15 check (buffer_before_min between 0 and 240),
  grace_period_min integer not null default 15 check (grace_period_min between 0 and 240),
  default_duration_min integer not null default 90 check (default_duration_min between 15 and 720),
  updated_at timestamptz not null default now()
);

insert into public.fb_reservation_settings (scope_key) values ('global') on conflict (scope_key) do nothing;

-- ── Reservations ─────────────────────────────────────────────────────────────
alter table public.fb_reservations alter column id set default gen_random_uuid()::text;
alter table public.fb_reservations add column if not exists reservation_date date;
alter table public.fb_reservations add column if not exists duration_min integer not null default 90;
alter table public.fb_reservations add column if not exists starts_at timestamptz;
alter table public.fb_reservations add column if not exists ends_at timestamptz;
alter table public.fb_reservations add column if not exists notes text not null default '';
alter table public.fb_reservations add column if not exists status_note text not null default '';
alter table public.fb_reservations add column if not exists session_id text;
alter table public.fb_reservations add column if not exists seated_at timestamptz;
alter table public.fb_reservations add column if not exists completed_at timestamptz;
alter table public.fb_reservations add column if not exists no_show_at timestamptz;
alter table public.fb_reservations add column if not exists cancelled_at timestamptz;
alter table public.fb_reservations add column if not exists updated_at timestamptz not null default now();

-- Old rows were stored without a date. Normalise "7:30 PM" style times to HH:MM; the date stays empty
-- so they never block a table or get auto-marked until someone schedules them.
update public.fb_reservations
set time = to_char(to_timestamp(trim(time), 'HH12:MI AM'), 'HH24:MI')
where trim(time) ~* '^\d{1,2}:\d{2}\s*(am|pm)$';

update public.fb_reservations set duration_min = 90 where duration_min is null or duration_min < 15;
update public.fb_reservations set status = 'Confirmed' where status is null or trim(status) = '';

alter table public.fb_reservations drop constraint if exists fb_reservations_status_check;
alter table public.fb_reservations add constraint fb_reservations_status_check
  check (status in ('Confirmed', 'Seated', 'Completed', 'No Show', 'Cancelled'));
alter table public.fb_reservations drop constraint if exists fb_reservations_duration_check;
alter table public.fb_reservations add constraint fb_reservations_duration_check
  check (duration_min between 15 and 720);
alter table public.fb_reservations drop constraint if exists fb_reservations_window_check;
alter table public.fb_reservations add constraint fb_reservations_window_check
  check (starts_at is null or ends_at > starts_at);

create index if not exists idx_fb_reservations_outlet_date on public.fb_reservations (outlet_id, reservation_date);
create index if not exists idx_fb_reservations_status_start on public.fb_reservations (status, starts_at);
create index if not exists idx_fb_reservations_session on public.fb_reservations (session_id);

-- ── Sessions: record when staff seat a walk-in over an active reservation ────
alter table public.fb_table_sessions add column if not exists override_reservation_id text;
alter table public.fb_table_sessions add column if not exists override_reason text;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.fb_reservation_settings enable row level security;
drop policy if exists "anon_all_fb_reservation_settings" on public.fb_reservation_settings;
create policy "anon_all_fb_reservation_settings" on public.fb_reservation_settings
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';

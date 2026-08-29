-- Explicit date-range room blocks for Front Office availability calendar.
-- Run after front-office-schema.sql and maintenance-requests.sql
-- Housekeeping tasks do NOT write here — only maintenance/OOS/renovation periods.

create table if not exists public.room_availability_blocks (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  block_type text not null default 'OUT_OF_SERVICE'
    check (block_type in ('MAINTENANCE', 'OUT_OF_SERVICE', 'RENOVATION')),
  start_date date not null,
  end_date date not null,
  reason text,
  source_type text,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_availability_blocks_dates_chk check (end_date >= start_date)
);

create index if not exists idx_room_availability_blocks_room
  on public.room_availability_blocks (room_id);

create index if not exists idx_room_availability_blocks_dates
  on public.room_availability_blocks (start_date, end_date);

alter table public.room_availability_blocks enable row level security;

drop policy if exists "anon_all_room_availability_blocks" on public.room_availability_blocks;
create policy "anon_all_room_availability_blocks"
  on public.room_availability_blocks
  for all using (true) with check (true);

comment on table public.room_availability_blocks is
  'Dated FO availability blocks — reservations and these rows block selling; HK tasks do not.';

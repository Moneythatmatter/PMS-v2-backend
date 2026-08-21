-- Patch: housekeeping_tasks — scheduling + multi-room batch grouping
-- Run once in Supabase SQL Editor.

alter table public.housekeeping_tasks
  add column if not exists cleaning_date date,
  add column if not exists schedule_start_date date,
  add column if not exists schedule_end_date date,
  add column if not exists schedule_start_time time,
  add column if not exists schedule_end_time time,
  add column if not exists batch_id text;

create index if not exists housekeeping_tasks_batch_id_idx
  on public.housekeeping_tasks (batch_id)
  where batch_id is not null;

create index if not exists housekeeping_tasks_cleaning_date_idx
  on public.housekeeping_tasks (cleaning_date)
  where cleaning_date is not null;

notify pgrst, 'schema cache';

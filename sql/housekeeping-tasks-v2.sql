-- STEP 2 — Run ONLY after housekeeping-tasks-v2-enums.sql succeeded.
-- Safe to re-run: skips enum data fixes if new values are not present yet.

-- New schedule + request columns (does not need new enum values)
alter table public.housekeeping_tasks
  add column if not exists scheduled_date date,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists request_id text;

-- Backfill from legacy split date/time columns (if present)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'housekeeping_tasks'
      and column_name = 'cleaning_date'
  ) then
    update public.housekeeping_tasks
    set
      scheduled_date = coalesce(cleaning_date, schedule_start_date),
      scheduled_start_at = case
        when coalesce(cleaning_date, schedule_start_date) is not null
          and schedule_start_time is not null
        then (coalesce(cleaning_date, schedule_start_date)::text || ' ' || schedule_start_time::text)::timestamptz
        else null
      end,
      due_at = case
        when coalesce(cleaning_date, schedule_end_date, schedule_start_date) is not null
          and schedule_end_time is not null
        then (coalesce(cleaning_date, schedule_end_date, schedule_start_date)::text || ' ' || schedule_end_time::text)::timestamptz
        else null
      end
    where scheduled_date is null
      and (
        cleaning_date is not null
        or schedule_start_date is not null
        or schedule_start_time is not null
        or schedule_end_time is not null
      );

    alter table public.housekeeping_tasks
      drop column if exists cleaning_date,
      drop column if exists schedule_start_date,
      drop column if exists schedule_end_date,
      drop column if exists schedule_start_time,
      drop column if exists schedule_end_time,
      drop column if exists batch_id;
  end if;
end $$;

drop index if exists public.housekeeping_tasks_batch_id_idx;
drop index if exists public.housekeeping_tasks_cleaning_date_idx;

create index if not exists housekeeping_tasks_scheduled_date_idx
  on public.housekeeping_tasks (scheduled_date)
  where scheduled_date is not null;

create index if not exists housekeeping_tasks_due_at_idx
  on public.housekeeping_tasks (due_at)
  where due_at is not null;

create index if not exists housekeeping_tasks_request_id_idx
  on public.housekeeping_tasks (request_id)
  where request_id is not null;

-- Legacy enum value migration (requires step 1 to have committed)
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'hk_task_type'
      and e.enumlabel = 'GUEST_REQUEST'
  ) then
    update public.housekeeping_tasks
    set task_type = 'GUEST_REQUEST'::public.hk_task_type
    where task_type = 'SPECIAL_REQUEST'::public.hk_task_type;
  else
    raise notice 'Skipped SPECIAL_REQUEST → GUEST_REQUEST (run housekeeping-tasks-v2-enums.sql first)';
  end if;

  if exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'hk_task_status'
      and e.enumlabel = 'PENDING_INSPECTION'
  ) then
    update public.housekeeping_tasks
    set status = 'PENDING_INSPECTION'::public.hk_task_status
    where status = 'COMPLETED'::public.hk_task_status;
  else
    raise notice 'Skipped COMPLETED → PENDING_INSPECTION (run housekeeping-tasks-v2-enums.sql first)';
  end if;
end $$;

notify pgrst, 'schema cache';

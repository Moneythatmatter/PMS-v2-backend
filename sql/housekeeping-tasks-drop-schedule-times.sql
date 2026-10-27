-- Remove cleaning-task time windows (start time / due time).
-- Tasks keep scheduled_date (the cleaning date); "overdue" is now derived from it.
-- Run in the Supabase SQL editor after deploying the backend that no longer
-- writes these columns. Safe to re-run.

drop index if exists public.housekeeping_tasks_due_at_idx;

alter table public.housekeeping_tasks
  drop column if exists scheduled_start_at,
  drop column if exists due_at;

notify pgrst, 'reload schema';

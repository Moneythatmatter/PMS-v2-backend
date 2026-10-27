-- Allow multiple staff on a cleaning task / public area.
-- housekeeping_tasks.assigned_to keeps the first assignee (room board, legacy code);
-- hk_public_areas.assigned_staff keeps the joined display names.
-- Safe to re-run.

alter table public.housekeeping_tasks
  add column if not exists assigned_staff_ids text[] not null default '{}';

update public.housekeeping_tasks
set assigned_staff_ids = array[assigned_to]
where assigned_to is not null
  and assigned_to <> ''
  and cardinality(assigned_staff_ids) = 0;

alter table public.hk_public_areas
  add column if not exists assigned_staff_ids text[] not null default '{}';

notify pgrst, 'reload schema';

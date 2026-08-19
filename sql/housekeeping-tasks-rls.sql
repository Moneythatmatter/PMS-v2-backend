-- Patch: RLS for housekeeping_tasks (+ related HK ops tables)
-- Run once in Supabase SQL Editor if you see:
--   "new row violates row-level security policy for table housekeeping_tasks"
--
-- Also drops users FK on staff columns (HK UI uses hk_staff names, not users.id)

do $$
declare
  t text;
begin
  foreach t in array array[
    'housekeeping_tasks',
    'hk_rooms',
    'public_areas',
    'guest_requests',
    'maintenance_requests',
    'hk_history'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
      execute format(
        'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
        t, t
      );
      -- authenticated JWT sessions (if used later)
      execute format('drop policy if exists "authenticated_all_%s" on public.%I', t, t);
      execute format(
        'create policy "authenticated_all_%s" on public.%I for all to authenticated using (true) with check (true)',
        t, t
      );
    end if;
  end loop;
end $$;

-- Staff columns store hk_staff.id or display name (not users.id)
alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_assigned_to_fkey;

alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_created_by_fkey;

alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_approved_by_fkey;

notify pgrst, 'schema cache';

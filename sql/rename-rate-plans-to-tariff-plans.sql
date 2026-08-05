-- Rename Rate Plans → Tariff Plans (run once in Supabase SQL Editor)
-- Safe to re-run: checks existence before renaming.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'rate_plans'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tariff_plans'
  ) then
    alter table public.rate_plans rename to tariff_plans;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'rate_plan'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'tariff_plan'
  ) then
    alter table public.reservations rename column rate_plan to tariff_plan;
  end if;
end $$;

-- Ensure RLS is enabled on renamed table
alter table if exists public.tariff_plans enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tariff_plans'
  ) and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tariff_plans' and policyname = 'Allow all tariff_plans'
  ) then
    create policy "Allow all tariff_plans" on public.tariff_plans for all using (true) with check (true);
  end if;
end $$;

-- Engineering Maintenance module schema (mnt_*)
-- Run in Supabase SQL Editor AFTER multi-property-schema.sql (properties table)
-- and after pgcrypto is enabled.
-- Idempotent: safe to re-run.
-- Distinct from housekeeping `maintenance_requests` (ops tickets).
-- Every mnt_* row is scoped by property_id (NOT NULL + FK).
-- If tables already exist without property_id / with nulls, also run:
--   maintenance-property-id-patch.sql

create extension if not exists pgcrypto;

-- ─── Masters ───────────────────────────────────────────────────────────────

create table if not exists mnt_asset_categories (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  category_code text not null,
  category_name text not null,
  description text,
  asset_count integer not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_problem_categories (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  category_code text not null,
  category_name text not null,
  description text,
  request_count integer not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_root_causes (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  root_cause_code text not null,
  root_cause_name text not null,
  description text,
  used_in_work_orders integer not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_pm_templates (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  template_code text not null,
  template_title text not null,
  category text not null default '',
  default_frequency text not null default 'Monthly',
  checklist jsonb not null default '[]'::jsonb,
  estimated_hours numeric(8,2),
  safety_note text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_vendors (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  vendor_code text not null,
  vendor_name text not null,
  service_category text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  address text,
  service_type text not null default 'On-Demand',
  service_reference text,
  contract_start_date text,
  contract_end_date text,
  notes text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_spare_parts (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  part_code text not null,
  part_name text not null,
  category text not null default '',
  unit text not null default 'Pcs',
  unit_cost numeric(12,2) not null default 0,
  default_stores_ref text,
  description text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Operational documents (filter columns + full payload jsonb) ──────────

create table if not exists mnt_assets (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  asset_code text not null,
  asset_name text not null,
  category text not null default '',
  location_type text,
  location text,
  status text not null default 'Operational',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_requests (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  request_no text not null,
  date_time text,
  location_type text,
  location text,
  category text,
  issue_title text,
  priority text not null default 'Medium',
  status text not null default 'New',
  work_order_no text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_work_orders (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  wo_number text not null,
  request_ref text,
  wo_type text,
  location text,
  location_type text,
  room_block_type text,
  problem_category text,
  priority text not null default 'Medium',
  status text not null default 'Assigned',
  due_date text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_pm_schedules (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  pm_number text not null,
  asset_code text,
  asset_name text,
  category text,
  location text,
  task_title text,
  frequency text,
  next_due_date text,
  status text not null default 'Upcoming',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_mnt_asset_categories_code
  on mnt_asset_categories (property_id, category_code);
create unique index if not exists uq_mnt_problem_categories_code
  on mnt_problem_categories (property_id, category_code);
create unique index if not exists uq_mnt_root_causes_code
  on mnt_root_causes (property_id, root_cause_code);
create unique index if not exists uq_mnt_pm_templates_code
  on mnt_pm_templates (property_id, template_code);
create unique index if not exists uq_mnt_vendors_code
  on mnt_vendors (property_id, vendor_code);
create unique index if not exists uq_mnt_spare_parts_code
  on mnt_spare_parts (property_id, part_code);
create unique index if not exists uq_mnt_assets_code
  on mnt_assets (property_id, asset_code);
create unique index if not exists uq_mnt_requests_no
  on mnt_requests (property_id, request_no);
create unique index if not exists uq_mnt_work_orders_no
  on mnt_work_orders (property_id, wo_number);
create unique index if not exists uq_mnt_pm_schedules_no
  on mnt_pm_schedules (property_id, pm_number);

create index if not exists idx_mnt_requests_status on mnt_requests (status);
create index if not exists idx_mnt_work_orders_status on mnt_work_orders (status);
create index if not exists idx_mnt_pm_schedules_due on mnt_pm_schedules (next_due_date);
create index if not exists idx_mnt_assets_status on mnt_assets (status);

create index if not exists idx_mnt_asset_categories_property_id on mnt_asset_categories (property_id);
create index if not exists idx_mnt_problem_categories_property_id on mnt_problem_categories (property_id);
create index if not exists idx_mnt_root_causes_property_id on mnt_root_causes (property_id);
create index if not exists idx_mnt_pm_templates_property_id on mnt_pm_templates (property_id);
create index if not exists idx_mnt_vendors_property_id on mnt_vendors (property_id);
create index if not exists idx_mnt_spare_parts_property_id on mnt_spare_parts (property_id);
create index if not exists idx_mnt_assets_property_id on mnt_assets (property_id);
create index if not exists idx_mnt_requests_property_id on mnt_requests (property_id);
create index if not exists idx_mnt_work_orders_property_id on mnt_work_orders (property_id);
create index if not exists idx_mnt_pm_schedules_property_id on mnt_pm_schedules (property_id);

-- ─── Location mirrors (FO rooms + HK public_areas) ─────────────────────────

do $$
begin
  create type public.mnt_location_status as enum (
    'Operational',
    'Under Maintenance',
    'Out of Service'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists mnt_rooms (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  room_id text not null unique references rooms(id) on delete cascade,
  status public.mnt_location_status not null default 'Operational',
  notes text,
  last_serviced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mnt_public_areas (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  public_area_id text not null unique references public_areas(id) on delete cascade,
  status public.mnt_location_status not null default 'Operational',
  notes text,
  last_serviced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mnt_rooms_property_id on mnt_rooms (property_id);
create index if not exists idx_mnt_rooms_status on mnt_rooms (status);
create index if not exists idx_mnt_public_areas_property_id on mnt_public_areas (property_id);
create index if not exists idx_mnt_public_areas_status on mnt_public_areas (status);

-- ========== RLS (anon access — same pattern as PS / SM) ==========
do $$
declare
  t text;
begin
  foreach t in array array[
    'mnt_asset_categories','mnt_problem_categories','mnt_root_causes',
    'mnt_pm_templates','mnt_vendors','mnt_spare_parts','mnt_assets','mnt_requests',
    'mnt_work_orders','mnt_pm_schedules','mnt_rooms','mnt_public_areas'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

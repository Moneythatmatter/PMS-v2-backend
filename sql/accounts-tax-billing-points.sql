-- Accounts → Tax/GST Master → Billing Points
--
-- Maps where a charge is raised (module + billing point) to a revenue category.
-- The tax itself still comes from acc_tax_rules (category + amount slab + dates),
-- so a GST rate change is edited in one place only.
--
-- Billing points understood by the backend (services/accounts/tax-resolver.ts):
--   FO_ROOM_NIGHT       Front Office · Night audit / checkout room charge (defaults to ROOM when unmapped)
--   FB_RESTAURANT_BILL  Food & Beverages · Dine-in / takeaway bill   (no tax until mapped)
--   FB_ROOM_SERVICE     Food & Beverages · Room service bill          (no tax until mapped)
--
-- Run after accounts-schema.sql. Safe to re-run.

create table if not exists public.acc_tax_applications (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  billing_point text not null,
  revenue_category_id uuid not null references public.acc_revenue_categories(id) on delete restrict,
  price_includes_tax boolean not null default false,
  -- Empty: category Tax Rules decide. Set: exactly these acc_tax_rules apply (each in its own amount range).
  tax_rule_ids uuid[] not null default '{}',
  effective_from date not null default current_date,
  effective_to date,
  description text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_tax_applications_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists acc_tax_applications_point_idx
  on public.acc_tax_applications (property_id, billing_point, status);

alter table public.acc_tax_applications enable row level security;

drop policy if exists "anon_all_acc_tax_applications" on public.acc_tax_applications;
create policy "anon_all_acc_tax_applications" on public.acc_tax_applications
  for all to anon using (true) with check (true);

drop policy if exists "authenticated_all_acc_tax_applications" on public.acc_tax_applications;
create policy "authenticated_all_acc_tax_applications" on public.acc_tax_applications
  for all to authenticated using (true) with check (true);

-- Make today's room-tax behaviour explicit: room nights use the ROOM category.
-- F&B points are not seeded, so restaurant bills keep 0 tax until you map them.
insert into public.acc_tax_applications (
  property_id, company_id, billing_point, revenue_category_id,
  price_includes_tax, effective_from, description, created_by
)
select
  c.property_id, c.company_id, 'FO_ROOM_NIGHT', c.id,
  false, date '2026-04-01', 'Room tariff charged per night (Night Audit / checkout)', 'system'
from public.acc_revenue_categories c
where c.revenue_category_code = 'ROOM'
  and c.status = 'Active'
  and not exists (
    select 1 from public.acc_tax_applications a
    where a.property_id = c.property_id and a.billing_point = 'FO_ROOM_NIGHT'
  );

notify pgrst, 'reload schema';

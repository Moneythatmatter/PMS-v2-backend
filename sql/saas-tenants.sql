-- SaaS tenants layer (no subscription plans)
-- Run in Supabase SQL Editor after multi-property-schema.sql
-- After this, also run users-role-tiers.sql to set Super Admin / Admin / User roles.

-- ========== TENANTS ==========
create table if not exists public.tenants (
  id text primary key,
  name text not null,
  slug text not null,
  status text not null default 'Active',
  property_limit integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_unique unique (slug)
);

alter table public.tenants
  add column if not exists property_limit integer not null default 5;

create index if not exists idx_tenants_status on public.tenants (status);

create table if not exists public.tenant_users (
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists idx_tenant_users_user on public.tenant_users (user_id);
create index if not exists idx_tenant_users_tenant on public.tenant_users (tenant_id);

-- Properties belong to a tenant
alter table public.properties
  add column if not exists tenant_id text references public.tenants(id) on delete restrict;

create index if not exists idx_properties_tenant on public.properties (tenant_id);

-- Optional home tenant on users (convenience)
alter table public.users
  add column if not exists tenant_id text references public.tenants(id) on delete set null;

create index if not exists idx_users_tenant on public.users (tenant_id);

-- ========== SEED DEFAULT TENANT ==========
insert into public.tenants (id, name, slug, status)
values ('tenant-default', 'Default Tenant', 'default', 'Active')
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status,
  updated_at = now();

update public.properties
set tenant_id = 'tenant-default'
where tenant_id is null;

-- Link existing property users into default tenant as members (not tenant admins).
-- Only users.role Admin / Super Admin should be tenant_users.role = admin.
insert into public.tenant_users (tenant_id, user_id, role)
select distinct 'tenant-default', upa.user_id, 'member'
from public.user_property_access upa
on conflict (tenant_id, user_id) do nothing;

insert into public.tenant_users (tenant_id, user_id, role)
select 'tenant-default', u.id, 'admin'
from public.users u
where coalesce(u.is_super_admin, false) = true
   or lower(trim(u.role)) in ('admin', 'administrator', 'super admin', 'superadmin')
on conflict (tenant_id, user_id) do update
  set role = excluded.role;

update public.users u
set tenant_id = 'tenant-default'
where u.tenant_id is null
  and exists (
    select 1 from public.tenant_users tu
    where tu.user_id = u.id and tu.tenant_id = 'tenant-default'
  );

-- ========== tenant_id on property-scoped operational tables ==========
do $$
declare
  t text;
  tables text[] := array[
    'room_types', 'rooms', 'tariff_plans', 'companies', 'booking_sources',
    'guests', 'reservations', 'reservation_guests', 'fo_groups', 'fo_group_billing_rules',
    'folio_charges', 'fo_company_bills', 'guest_stay_history', 'guest_documents',
    'folio_entries', 'folios', 'payments', 'transactions', 'invoices',
    'room_transfers', 'wake_up_calls', 'taxi_bookings', 'luggage_items', 'messages',
    'guest_feedback', 'lost_found_items', 'housekeeping_requests', 'maintenance_requests',
    'cashier_shifts', 'fo_cashier_sessions', 'room_charge_postings', 'day_closings',
    'fo_night_audits', 'desk_activity', 'room_availability_blocks',
    'hk_rooms', 'housekeeping_tasks', 'guest_requests', 'damage_reports',
    'hk_inventory', 'hk_laundry_jobs', 'hk_requisitions', 'hk_history', 'hk_settings',
    'public_areas', 'hk_public_areas',
    'ps_units', 'ps_categories', 'ps_suppliers', 'ps_products', 'ps_warehouses',
    'purchase_requisitions', 'purchase_requisition_items', 'ps_rfqs', 'ps_purchase_orders',
    'ps_direct_store_purchases', 'ps_rate_contracts', 'ps_invoices', 'ps_grns',
    'ps_quality_inspections', 'ps_vendor_returns', 'ps_stock_balances', 'ps_stock_ledger',
    'ps_stock_issues', 'ps_stock_transfers', 'ps_stock_adjustments', 'ps_par_stock', 'ps_batches',
    'fb_outlets', 'fb_outlet_types', 'fb_live_tables', 'fb_table_sessions',
    'fb_orders', 'fb_order_items', 'fb_kot_tickets', 'fb_kot_items', 'fb_bills',
    'fb_kds_tickets', 'fb_cashier_shifts', 'fb_day_closings', 'fb_cashier_sessions',
    'fb_outlet_day_closings', 'fb_reservations', 'fb_guest_order_requests',
    'fb_modifier_groups', 'fb_modifiers', 'fb_menu_item_modifier_groups',
    'fb_ingredients', 'fb_recipes', 'fb_recipe_ingredients', 'fb_recipe_consumptions',
    'fb_wastage', 'fb_stock_adjustments',
    'fb_conversion_items', 'fb_conversion_item_lines', 'fb_conversions', 'fb_conversion_lines',
    'fb_module_records', 'fnb_menu_categories', 'fnb_menu_items', 'fnb_tax_groups', 'fnb_units',
    'hr_departments', 'hr_designations', 'hr_employment_types', 'hr_shift_types',
    'hr_leave_types', 'hr_leave_policies', 'hr_holidays', 'hr_salary_components',
    'hr_document_categories', 'hr_document_types', 'hr_employees', 'hr_employee_documents',
    'hr_attendance_records', 'hr_shift_assignments', 'hr_weekly_offs', 'hr_leave_applications',
    'hr_leave_balance_transactions', 'hr_overtime_records', 'hr_salary_structures',
    'hr_payroll_records', 'hr_salary_payments', 'hr_payslips', 'hr_complaint_categories',
    'hr_complaints', 'hr_approval_workflows', 'hr_payroll_settings', 'hr_tax_rules', 'hr_audit_logs',
    'sm_venues', 'sm_lead_sources', 'sm_activity_types', 'sm_deal_stages', 'sm_contact_types',
    'sm_booking_types', 'sm_contacts', 'sm_leads', 'sm_deals', 'sm_activities',
    'sm_bookings', 'sm_promotions', 'sm_campaigns', 'sm_ota_channels',
    'mnt_asset_categories', 'mnt_problem_categories', 'mnt_root_causes', 'mnt_pm_templates',
    'mnt_vendors', 'mnt_spare_parts', 'mnt_assets', 'mnt_requests', 'mnt_work_orders',
    'mnt_pm_schedules', 'mnt_rooms', 'mnt_public_areas',
    'acc_currencies', 'acc_companies', 'acc_company_settings', 'acc_fiscal_years',
    'acc_fiscal_periods', 'acc_accounts', 'acc_divisions', 'acc_party_sub_types',
    'acc_payment_methods', 'acc_parties', 'acc_voucher_types', 'acc_revenue_categories',
    'acc_tax_definitions', 'acc_tax_rules', 'acc_budgets', 'acc_vouchers', 'acc_voucher_lines',
    'acc_party_bills', 'acc_bill_settlements', 'acc_closing_stock_items',
    'acc_covering_letters', 'acc_covering_letter_bills', 'acc_audit_logs'
  ];
begin
  foreach t in array tables loop
    begin
      if to_regclass(format('public.%I', t)) is null then
        continue;
      end if;

      execute format(
        'alter table public.%I add column if not exists tenant_id text references public.tenants(id) on delete restrict',
        t
      );
      execute format(
        'create index if not exists idx_%I_tenant on public.%I (tenant_id)',
        t, t
      );

      -- Ensure property_id is indexed (idempotent)
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'property_id'
      ) then
        execute format(
          'create index if not exists idx_%I_property on public.%I (property_id)',
          t, t
        );
        execute format(
          'update public.%I x
             set tenant_id = p.tenant_id
            from public.properties p
           where x.property_id = p.id
             and x.tenant_id is null
             and p.tenant_id is not null',
          t
        );
      else
        execute format(
          'update public.%I set tenant_id = %L where tenant_id is null',
          t, 'tenant-default'
        );
      end if;
    exception
      when others then
        raise notice 'saas-tenants skip %: %', t, sqlerrm;
    end;
  end loop;
end $$;

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;

drop policy if exists "anon_all_tenants" on public.tenants;
create policy "anon_all_tenants" on public.tenants for all using (true) with check (true);

drop policy if exists "anon_all_tenant_users" on public.tenant_users;
create policy "anon_all_tenant_users" on public.tenant_users for all using (true) with check (true);

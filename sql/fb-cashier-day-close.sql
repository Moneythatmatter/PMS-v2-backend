-- F&B outlet-wise cashier closing and day closing.
-- A cashier opens a shift at one outlet; F&B payments taken at that outlet are tagged to the shift.
-- Closing: count each payment method, submit, manager approves or sends back (same as Front Office).
-- Day close: one record per outlet per hotel business date, after the outlet's checks pass.
--
-- Run after food-beverages-schema.sql, fb-pos-v2-schema.sql, fb-property-scope.sql,
-- auth-users-schema.sql, multi-property-schema.sql and transactions.sql.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.fb_cashier_sessions (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references public.properties(id) on delete cascade,
  outlet_id text not null references public.fb_outlets(id) on delete cascade,
  cashier_id text not null references public.users(id) on delete restrict,
  shift_name text not null,
  business_date date,
  opened_at timestamptz not null default now(),
  opening_cash numeric(12,2) not null default 0,
  opening_remarks text,
  closed_at timestamptz,
  closing_cash_expected numeric(12,2),
  closing_cash_actual numeric(12,2),
  cash_variance numeric(12,2),
  closing_remarks text,
  status text not null default 'Open'
    check (status in ('Open', 'Pending Approval', 'Closed', 'Rejected')),
  closed_by text references public.users(id) on delete set null,
  approved_by text references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open shift per cashier per outlet.
create unique index if not exists fb_cashier_one_open_per_outlet
  on public.fb_cashier_sessions (property_id, outlet_id, cashier_id)
  where status = 'Open';

create index if not exists idx_fb_cashier_sessions_outlet
  on public.fb_cashier_sessions (property_id, outlet_id, opened_at desc);

create table if not exists public.fb_cashier_reconciliations (
  id text primary key default gen_random_uuid()::text,
  cashier_session_id text not null references public.fb_cashier_sessions(id) on delete cascade,
  payment_method text not null,
  opening_amount numeric(12,2) not null default 0,
  total_received numeric(12,2) not null default 0,
  total_refunded numeric(12,2) not null default 0,
  total_paid_out numeric(12,2) not null default 0,
  expected_amount numeric(12,2) not null default 0,
  actual_amount numeric(12,2),
  variance numeric(12,2),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fb_cashier_reconciliations_method_unique unique (cashier_session_id, payment_method)
);

create table if not exists public.fb_cashier_session_audits (
  id text primary key default gen_random_uuid()::text,
  cashier_session_id text not null references public.fb_cashier_sessions(id) on delete cascade,
  action text not null,
  actor_id text references public.users(id) on delete set null,
  from_status text,
  to_status text,
  snapshot jsonb not null default '{}'::jsonb,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fb_cashier_audits_session
  on public.fb_cashier_session_audits (cashier_session_id, created_at);

-- F&B payments are tagged to the F&B shift that took them.
alter table public.transactions
  add column if not exists fb_cashier_session_id text references public.fb_cashier_sessions(id) on delete set null;

create index if not exists idx_transactions_fb_cashier_session
  on public.transactions (fb_cashier_session_id)
  where fb_cashier_session_id is not null;

create table if not exists public.fb_outlet_day_closings (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references public.properties(id) on delete cascade,
  outlet_id text not null references public.fb_outlets(id) on delete cascade,
  business_date date not null,
  bills_count int not null default 0,
  gross_sales numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  net_sales numeric(12,2) not null default 0,
  room_charges numeric(12,2) not null default 0,
  collections numeric(12,2) not null default 0,
  summary jsonb not null default '{}'::jsonb,
  closed_at timestamptz not null default now(),
  closed_by text references public.users(id) on delete set null,
  closed_by_name text,
  created_at timestamptz not null default now(),
  constraint fb_outlet_day_closings_unique unique (property_id, outlet_id, business_date)
);

create index if not exists idx_fb_outlet_day_closings_date
  on public.fb_outlet_day_closings (property_id, business_date desc);

do $$
declare
  t text;
begin
  foreach t in array array[
    'fb_cashier_sessions',
    'fb_cashier_reconciliations',
    'fb_cashier_session_audits',
    'fb_outlet_day_closings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
    execute format(
      'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

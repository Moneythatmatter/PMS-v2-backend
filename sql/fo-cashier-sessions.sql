-- Front Office cashier shift start, closing, and payment reconciliation.
-- Run in the Supabase SQL editor after front-office-schema.sql, auth-users-schema.sql,
-- multi-property-schema.sql, and transactions.sql.
--
-- properties.id and users.id are text keys that store UUIDs (or legacy codes).
-- Session ids use the same text UUID style so the foreign keys match those tables.
-- Reconciliation reads public.transactions. It does not copy payment rows.

create extension if not exists pgcrypto;

create table if not exists public.fo_cashier_sessions (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references public.properties(id) on delete cascade,
  cashier_id text not null references public.users(id) on delete restrict,
  shift_name text not null,
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

create unique index if not exists fo_cashier_one_open_per_cashier
  on public.fo_cashier_sessions (property_id, cashier_id)
  where status = 'Open';

create index if not exists idx_fo_cashier_sessions_property
  on public.fo_cashier_sessions (property_id, opened_at desc);

create table if not exists public.fo_cashier_reconciliations (
  id text primary key default gen_random_uuid()::text,
  cashier_session_id text not null references public.fo_cashier_sessions(id) on delete cascade,
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
  constraint fo_cashier_reconciliations_method_unique unique (cashier_session_id, payment_method)
);

create table if not exists public.fo_cashier_session_audits (
  id text primary key default gen_random_uuid()::text,
  cashier_session_id text not null references public.fo_cashier_sessions(id) on delete cascade,
  action text not null,
  actor_id text references public.users(id) on delete set null,
  from_status text,
  to_status text,
  snapshot jsonb not null default '{}'::jsonb,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fo_cashier_audits_session
  on public.fo_cashier_session_audits (cashier_session_id, created_at);

alter table public.transactions
  add column if not exists cashier_session_id text references public.fo_cashier_sessions(id) on delete set null;

create index if not exists idx_transactions_cashier_session
  on public.transactions (cashier_session_id)
  where cashier_session_id is not null;

alter table public.fo_cashier_sessions enable row level security;
alter table public.fo_cashier_reconciliations enable row level security;
alter table public.fo_cashier_session_audits enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'fo_cashier_sessions',
    'fo_cashier_reconciliations',
    'fo_cashier_session_audits'
  ]
  loop
    execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
    execute format(
      'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

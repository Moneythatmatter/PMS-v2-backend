-- Leave ↔ Attendance ↔ Balance integration
-- Run after human-resources-attendance-v2-patch.sql

alter table hr_leave_applications
  add column if not exists calendar_days numeric(5,1),
  add column if not exists effective_days numeric(5,1),
  add column if not exists consumed_dates jsonb default '[]'::jsonb,
  add column if not exists excluded_dates jsonb default '[]'::jsonb,
  add column if not exists last_balance_transaction_id text;

create table if not exists hr_leave_balance_transactions (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  employee_id text not null references hr_employees(id) on delete cascade,
  leave_type_id text references hr_leave_types(id) on delete set null,
  leave_request_id text references hr_leave_applications(id) on delete set null,
  transaction_type text not null
    check (transaction_type in ('CONSUMED', 'RESTORED', 'ADJUSTED', 'OPENING', 'REVERSAL')),
  days numeric(5,1) not null,
  balance_before jsonb,
  balance_after jsonb,
  effective_dates jsonb default '[]'::jsonb,
  transaction_date timestamptz not null default now(),
  remarks text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hr_leave_bal_txn_employee
  on hr_leave_balance_transactions(property_id, employee_id, leave_type_id);

create index if not exists idx_hr_leave_bal_txn_leave_req
  on hr_leave_balance_transactions(leave_request_id);

create unique index if not exists idx_hr_leave_bal_txn_consume_once
  on hr_leave_balance_transactions(leave_request_id, transaction_type)
  where transaction_type = 'CONSUMED';

alter table hr_leave_balance_transactions enable row level security;
drop policy if exists "anon_all_hr_leave_balance_transactions" on hr_leave_balance_transactions;
create policy "anon_all_hr_leave_balance_transactions"
  on hr_leave_balance_transactions for all to anon using (true) with check (true);

notify pgrst, 'reload schema';

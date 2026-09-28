-- =============================================================================
-- Accounts module — schema (all primary keys are native UUID)
-- Run order: accounts-schema.sql -> accounts-seeds.sql
-- Every table is property scoped (property_id -> properties.id).
-- =============================================================================

create extension if not exists pgcrypto;

create or replace function public.acc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------

create table if not exists public.acc_currencies (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  code text not null,
  name text not null,
  symbol text not null default '',
  country text not null default '',
  decimal_places int not null default 2,
  is_base_currency boolean not null default false,
  exchange_rate_to_base numeric(18,6) not null default 1,
  rate_effective_date date,
  rate_source text not null default 'Manual',
  foreign_transactions_allowed boolean not null default false,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_currencies_code_unique unique (property_id, code)
);

create table if not exists public.acc_companies (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_code text not null,
  trade_name text not null,
  legal_name text not null default '',
  alias text not null default '',
  company_type text not null default 'Private Limited',
  business_nature text not null default 'Hospitality',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  logo_url text,
  address_line1 text not null default '',
  address_line2 text not null default '',
  city text not null default '',
  district text not null default '',
  state text not null default '',
  pincode text not null default '',
  country text not null default 'India',
  primary_contact text not null default '',
  mobile text not null default '',
  telephone text not null default '',
  email text not null default '',
  website text not null default '',
  gst_number text not null default '',
  pan_number text not null default '',
  tan_number text not null default '',
  cin_number text not null default '',
  msme_number text not null default '',
  registration_date date,
  tax_region text not null default '',
  gst_applicable boolean not null default true,
  base_currency_id uuid references public.acc_currencies(id) on delete set null,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_companies_code_unique unique (property_id, company_code)
);

create table if not exists public.acc_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  fiscal_year_name text not null,
  fy_code text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'Upcoming' check (status in ('Upcoming','Open','Closed')),
  is_current boolean not null default false,
  carry_forward_balance_sheet boolean not null default true,
  carry_forward_customers boolean not null default true,
  carry_forward_vendors boolean not null default true,
  transfer_pnl_to_retained_earnings boolean not null default true,
  retained_earnings_account_id uuid,
  opened_at timestamptz,
  opened_by text,
  closed_at timestamptz,
  closed_by text,
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_fiscal_years_code_unique unique (property_id, fy_code),
  constraint acc_fiscal_years_dates check (end_date > start_date)
);

create table if not exists public.acc_fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  fiscal_year_id uuid not null references public.acc_fiscal_years(id) on delete cascade,
  period_no int not null,
  period_code text not null,
  period_name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'Open' check (status in ('Open','Closed')),
  closed_at timestamptz,
  closed_by text,
  reopened_at timestamptz,
  reopened_by text,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_fiscal_periods_no_unique unique (fiscal_year_id, period_no)
);

create table if not exists public.acc_company_settings (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid not null references public.acc_companies(id) on delete cascade,
  current_fiscal_year_id uuid references public.acc_fiscal_years(id) on delete set null,
  accounting_method text not null default 'Accrual' check (accounting_method in ('Accrual','Cash')),
  decimal_places int not null default 2,
  allow_future_transactions boolean not null default false,
  allow_back_dated_posting boolean not null default true,
  back_dated_limit_days int not null default 30,
  lock_date_before date,
  require_voucher_approval boolean not null default false,
  auto_voucher_numbering boolean not null default true,
  voucher_reset_frequency text not null default 'Yearly',
  allow_manual_voucher_no boolean not null default false,
  prevent_duplicate_vouchers boolean not null default true,
  require_posting_approval boolean not null default false,
  allow_negative_cash boolean not null default false,
  enforce_credit_limit boolean not null default true,
  default_receivable_account_id uuid,
  default_payable_account_id uuid,
  default_round_off_account_id uuid,
  default_guest_deposit_account_id uuid,
  enable_gst boolean not null default true,
  enable_einvoice boolean not null default false,
  default_tax_region text not null default '',
  enable_tds_deductions boolean not null default false,
  last_audit_date timestamptz,
  configured_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_company_settings_company_unique unique (company_id)
);

create table if not exists public.acc_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  parent_id uuid references public.acc_accounts(id) on delete restrict,
  code text not null,
  name text not null,
  account_type text not null default 'Ledger' check (account_type in ('Group','Ledger')),
  nature text not null check (nature in ('Asset','Liability','Income','Expense')),
  report_section text not null default '',
  category text not null default '',
  classification text not null default '',
  description text not null default '',
  allow_posting boolean not null default true,
  is_system_account boolean not null default false,
  is_bank_account boolean not null default false,
  is_cash_account boolean not null default false,
  bank_account_no text not null default '',
  bank_ifsc text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_accounts_code_unique unique (property_id, code)
);

alter table public.acc_fiscal_years
  drop constraint if exists acc_fiscal_years_retained_fk;
alter table public.acc_fiscal_years
  add constraint acc_fiscal_years_retained_fk
  foreign key (retained_earnings_account_id) references public.acc_accounts(id) on delete set null;

create table if not exists public.acc_divisions (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  parent_division_id uuid references public.acc_divisions(id) on delete set null,
  division_code text not null,
  division_name text not null,
  short_name text not null default '',
  division_type text not null default 'Revenue Center',
  sequence int not null default 1,
  description text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_divisions_code_unique unique (property_id, division_code)
);

create table if not exists public.acc_party_types (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  type_code text not null,
  type_name text not null,
  description text not null default '',
  sequence int not null default 1,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_party_types_code_unique unique (property_id, type_code)
);

create table if not exists public.acc_party_sub_types (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  party_type_id uuid not null references public.acc_party_types(id) on delete restrict,
  sub_type_code text not null,
  sub_type_name text not null,
  description text not null default '',
  sequence int not null default 1,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_party_sub_types_code_unique unique (property_id, sub_type_code)
);

create table if not exists public.acc_payment_methods (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  account_id uuid references public.acc_accounts(id) on delete set null,
  payment_method_code text not null,
  payment_method_name text not null,
  method_type text not null default 'Cash',
  reference_required boolean not null default false,
  description text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_payment_methods_code_unique unique (property_id, payment_method_code)
);

create table if not exists public.acc_parties (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  party_code text not null,
  party_name text not null,
  short_name text not null default '',
  party_type_id uuid references public.acc_party_types(id) on delete set null,
  party_sub_type_id uuid references public.acc_party_sub_types(id) on delete set null,
  party_group text not null default 'Sundry Debtors',
  entity_type text not null default 'Company',
  email text not null default '',
  phone text not null default '',
  alternate_phone text not null default '',
  website text not null default '',
  address_line1 text not null default '',
  address_line2 text not null default '',
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  country text not null default 'India',
  contact_person_name text not null default '',
  contact_person_phone text not null default '',
  contact_person_email text not null default '',
  contact_person_designation text not null default '',
  pan_number text not null default '',
  gstin text not null default '',
  gst_registration_type text not null default 'Regular',
  tan_number text not null default '',
  msme_number text not null default '',
  msme_type text not null default 'Non-MSME',
  currency_id uuid references public.acc_currencies(id) on delete set null,
  credit_days int not null default 0,
  credit_limit numeric(18,2) not null default 0,
  payment_method_id uuid references public.acc_payment_methods(id) on delete set null,
  bank_name text not null default '',
  bank_account_number text not null default '',
  bank_ifsc text not null default '',
  bank_branch text not null default '',
  bank_account_type text not null default 'Current',
  receivable_account_id uuid references public.acc_accounts(id) on delete set null,
  payable_account_id uuid references public.acc_accounts(id) on delete set null,
  remarks text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive','Blocked')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_parties_code_unique unique (property_id, party_code)
);

create table if not exists public.acc_voucher_types (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  voucher_type_name text not null,
  short_code text not null,
  category text not null check (category in ('Journal','Receipt','Payment','Contra','Sales','Purchase','Credit Note','Debit Note','Opening')),
  sequence int not null default 1,
  numbering_method text not null default 'Automatic' check (numbering_method in ('Automatic','Manual')),
  prefix_template text not null default '',
  starting_number int not null default 1,
  number_padding int not null default 5,
  reset_frequency text not null default 'Yearly' check (reset_frequency in ('Never','Yearly','Monthly')),
  default_entry_nature text not null default 'None' check (default_entry_nature in ('Debit','Credit','None')),
  party_required boolean not null default false,
  division_required boolean not null default false,
  is_system boolean not null default false,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_voucher_types_code_unique unique (property_id, short_code)
);

create table if not exists public.acc_revenue_categories (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  income_account_id uuid references public.acc_accounts(id) on delete set null,
  revenue_category_code text not null,
  revenue_category_name text not null,
  description text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_revenue_categories_code_unique unique (property_id, revenue_category_code)
);

create table if not exists public.acc_tax_definitions (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  output_account_id uuid references public.acc_accounts(id) on delete set null,
  tax_code text not null,
  tax_name text not null,
  tax_type text not null default 'GST',
  rate numeric(9,4) not null default 0,
  calculation_type text not null default 'Percentage' check (calculation_type in ('Percentage','Fixed')),
  hsn_sac_code text not null default '',
  description text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_tax_definitions_code_unique unique (property_id, tax_code)
);

create table if not exists public.acc_tax_rules (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  company_id uuid references public.acc_companies(id) on delete set null,
  tax_id uuid not null references public.acc_tax_definitions(id) on delete restrict,
  revenue_category_id uuid references public.acc_revenue_categories(id) on delete set null,
  division_id uuid references public.acc_divisions(id) on delete set null,
  tax_rule_code text not null,
  tax_rule_name text not null,
  applicability_type text not null default 'Revenue Category',
  service_type text not null default '',
  minimum_amount numeric(18,2),
  maximum_amount numeric(18,2),
  priority int not null default 1,
  effective_from date not null default current_date,
  effective_to date,
  description text not null default '',
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_tax_rules_code_unique unique (property_id, tax_rule_code)
);

create table if not exists public.acc_budgets (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  fiscal_year_id uuid not null references public.acc_fiscal_years(id) on delete cascade,
  division_id uuid not null references public.acc_divisions(id) on delete cascade,
  budget_amount numeric(18,2) not null default 0,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_budgets_unique unique (fiscal_year_id, division_id)
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table if not exists public.acc_vouchers (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  voucher_no text not null,
  voucher_date date not null,
  voucher_type_id uuid not null references public.acc_voucher_types(id) on delete restrict,
  voucher_category text not null,
  fiscal_year_id uuid references public.acc_fiscal_years(id) on delete restrict,
  fiscal_period_id uuid references public.acc_fiscal_periods(id) on delete set null,
  reference_no text not null default '',
  narration text not null default '',
  status text not null default 'Draft' check (status in ('Draft','Posted','Provisional','Converted','Reversed')),
  is_provisional boolean not null default false,
  provisional_category text,
  provisional_type text,
  expiry_date date,
  converted_voucher_id uuid references public.acc_vouchers(id) on delete set null,
  party_id uuid references public.acc_parties(id) on delete set null,
  division_id uuid references public.acc_divisions(id) on delete set null,
  bank_cash_account_id uuid references public.acc_accounts(id) on delete set null,
  payment_method_id uuid references public.acc_payment_methods(id) on delete set null,
  instrument_no text not null default '',
  instrument_date date,
  total_amount numeric(18,2) not null default 0,
  source_module text not null default 'Accounts',
  prepared_by text,
  posted_at timestamptz,
  posted_by text,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  reprint_count int not null default 0,
  last_printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_vouchers_no_unique unique (property_id, voucher_no)
);

create table if not exists public.acc_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  voucher_id uuid not null references public.acc_vouchers(id) on delete cascade,
  line_no int not null default 1,
  account_id uuid not null references public.acc_accounts(id) on delete restrict,
  party_id uuid references public.acc_parties(id) on delete set null,
  division_id uuid references public.acc_divisions(id) on delete set null,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  narration text not null default '',
  cheque_no text not null default '',
  cheque_date date,
  gst_rate numeric(9,4),
  reconciled boolean not null default false,
  recon_date date,
  reconciled_by text,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_voucher_lines_amount check (debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0))
);

create table if not exists public.acc_party_bills (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  party_id uuid not null references public.acc_parties(id) on delete restrict,
  module_type text not null check (module_type in ('AR','AP')),
  ref_type text not null default 'Invoice',
  bill_no text not null,
  bill_date date not null,
  due_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  details text not null default '',
  voucher_id uuid references public.acc_vouchers(id) on delete set null,
  division_id uuid references public.acc_divisions(id) on delete set null,
  status text not null default 'Open' check (status in ('Open','Cancelled')),
  remarks text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_party_bills_no_unique unique (property_id, party_id, bill_no)
);

create table if not exists public.acc_bill_settlements (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  bill_id uuid not null references public.acc_party_bills(id) on delete cascade,
  voucher_id uuid references public.acc_vouchers(id) on delete set null,
  settlement_date date not null,
  trn_type text not null default 'Receipts',
  amount numeric(18,2) not null check (amount > 0),
  deductions numeric(18,2) not null default 0,
  reference_no text not null default '',
  remarks text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acc_closing_stock_items (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  valuation_date date not null,
  store_name text not null,
  valuation_method text not null default 'Weighted Average',
  item_code text not null,
  item_name text not null,
  category text not null default '',
  uom text not null default 'Nos',
  sys_qty numeric(18,3) not null default 0,
  physical_qty numeric(18,3) not null default 0,
  unit_rate numeric(18,2) not null default 0,
  prev_period_value numeric(18,2) not null default 0,
  stock_account_id uuid references public.acc_accounts(id) on delete set null,
  consumption_account_id uuid references public.acc_accounts(id) on delete set null,
  status text not null default 'Draft' check (status in ('Draft','Audited','GL Posted')),
  last_audit_date date,
  voucher_id uuid references public.acc_vouchers(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_closing_stock_unique unique (property_id, valuation_date, store_name, item_code)
);

create table if not exists public.acc_covering_letters (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  letter_no text not null,
  letter_date date not null,
  party_id uuid not null references public.acc_parties(id) on delete restrict,
  status text not null default 'Active' check (status in ('Active','Reversed')),
  total_amount numeric(18,2) not null default 0,
  bills_count int not null default 0,
  prepared_by text,
  remarks text not null default '',
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_covering_letters_no_unique unique (property_id, letter_no)
);

create table if not exists public.acc_covering_letter_bills (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  letter_id uuid not null references public.acc_covering_letters(id) on delete cascade,
  bill_id uuid not null references public.acc_party_bills(id) on delete restrict,
  amount numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_covering_letter_bills_unique unique (letter_id, bill_id)
);

create table if not exists public.acc_audit_logs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists acc_accounts_parent_idx on public.acc_accounts (parent_id);
create index if not exists acc_fiscal_periods_fy_idx on public.acc_fiscal_periods (fiscal_year_id, start_date);
create index if not exists acc_parties_type_idx on public.acc_parties (property_id, party_type_id);
create index if not exists acc_vouchers_date_idx on public.acc_vouchers (property_id, voucher_date);
create index if not exists acc_vouchers_type_idx on public.acc_vouchers (voucher_type_id, fiscal_year_id);
create index if not exists acc_vouchers_status_idx on public.acc_vouchers (property_id, status);
create index if not exists acc_voucher_lines_voucher_idx on public.acc_voucher_lines (voucher_id);
create index if not exists acc_voucher_lines_account_idx on public.acc_voucher_lines (property_id, account_id);
create index if not exists acc_voucher_lines_party_idx on public.acc_voucher_lines (party_id);
create index if not exists acc_party_bills_party_idx on public.acc_party_bills (property_id, party_id, module_type);
create index if not exists acc_bill_settlements_bill_idx on public.acc_bill_settlements (bill_id);
create index if not exists acc_closing_stock_date_idx on public.acc_closing_stock_items (property_id, valuation_date);
create index if not exists acc_audit_logs_entity_idx on public.acc_audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers + RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'acc_currencies','acc_companies','acc_fiscal_years','acc_fiscal_periods','acc_company_settings',
    'acc_accounts','acc_divisions','acc_party_types','acc_party_sub_types','acc_payment_methods',
    'acc_parties','acc_voucher_types','acc_revenue_categories','acc_tax_definitions','acc_tax_rules',
    'acc_budgets','acc_vouchers','acc_voucher_lines','acc_party_bills','acc_bill_settlements',
    'acc_closing_stock_items','acc_covering_letters','acc_covering_letter_bills','acc_audit_logs'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.acc_touch_updated_at()',
      t || '_touch', t
    );
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
    execute format(
      'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

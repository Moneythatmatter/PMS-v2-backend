-- Front Office → Accounts posting, phase 2.
--   1. Posting start date (nothing older is posted).
--   2. Reversal marker for payments / charges voided after they were posted.
--   3. Company on the reservation + "bill to company" amounts raised at checkout.
--   4. Default party sub types for every property (and new properties).
--
-- Run after accounts-fo-posting.sql and fo-companies-party-link.sql. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Posting start date
-- ---------------------------------------------------------------------------
alter table public.acc_company_settings
  add column if not exists fo_posting_start_date date;

-- ---------------------------------------------------------------------------
-- 2. Voided after posting
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists acc_void_voucher_id uuid references public.acc_vouchers(id) on delete set null;

create index if not exists transactions_acc_void_pending_idx
  on public.transactions (property_id)
  where acc_voucher_id is not null and acc_void_voucher_id is null;

-- ---------------------------------------------------------------------------
-- 3. Company on the reservation + bill to company
-- ---------------------------------------------------------------------------
alter table public.reservations add column if not exists company_id text;
create index if not exists reservations_company_id_idx
  on public.reservations (company_id) where company_id is not null;

-- Existing company bookings: link by company name within the property.
update public.reservations r
set company_id = c.id::text
from public.companies c
where r.company_id is null
  and coalesce(trim(r.company_name), '') <> ''
  and c.property_id = r.property_id
  and lower(trim(c.name)) = lower(trim(r.company_name));

create table if not exists public.fo_company_bills (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  bill_no text not null,
  reservation_id text references public.reservations(id) on delete set null,
  company_id text not null,
  party_id uuid not null references public.acc_parties(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  business_date date not null,
  status text not null default 'Open' check (status in ('Open', 'Void')),
  notes text not null default '',
  acc_voucher_id uuid references public.acc_vouchers(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists fo_company_bills_property_no_key
  on public.fo_company_bills (property_id, bill_no);
create index if not exists fo_company_bills_unposted_idx
  on public.fo_company_bills (property_id, business_date)
  where acc_voucher_id is null;

alter table public.fo_company_bills enable row level security;
drop policy if exists "anon_all_fo_company_bills" on public.fo_company_bills;
create policy "anon_all_fo_company_bills" on public.fo_company_bills
  for all to anon using (true) with check (true);
grant select, insert, update, delete on public.fo_company_bills to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Default party sub types
-- ---------------------------------------------------------------------------
create or replace function public.acc_seed_default_party_sub_types(p_property_id text)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.acc_party_sub_types (property_id, party_type_id, sub_type_code, sub_type_name, description, sequence)
  select p_property_id, t.id, x.code, x.name, x.description, x.seq
  from (values
    ('CUST',  'WALKIN',       'Walk-in Guest',         'Direct walk-in guests',                       1),
    ('CUST',  'CITYLEDGER',   'City Ledger',           'Guests billed on account',                    2),
    ('CORP',  'CORPCONTRACT', 'Contracted Corporate',  'Corporates with negotiated rates',            1),
    ('CORP',  'CORPNONCON',   'Non-Contracted Corporate', 'Corporates on public rates',               2),
    ('CORP',  'GOVT',         'Government / PSU',      'Government departments and PSUs',             3),
    ('CORP',  'MICE',         'MICE Client',           'Meetings, incentives, conferences and events', 4),
    ('TA',    'OFFLINETA',    'Offline Travel Agent',  'Tour operators and offline agents',           1),
    ('OTA',   'OTA',          'Online Travel Agent',   'Online booking channels',                     1),
    ('CC',    'CCACQ',        'Card Acquirer',         'EDC and payment gateway settlements',         1),
    ('VEND',  'FNBSUP',       'F&B Supplier',          'Food and beverage suppliers',                 1),
    ('VEND',  'UTIL',         'Utility Provider',      'Electricity, water and gas',                  2),
    ('VEND',  'AMC',          'Service / AMC Vendor',  'Maintenance contracts',                       3),
    ('VEND',  'MKTG',         'Marketing Agency',      'Advertising and digital marketing',           4),
    ('VEND',  'GENSUP',       'General Supplier',      'Housekeeping, stationery and other supplies', 5),
    ('EMP',   'STAFF',        'Staff Advance',         'Salary and travel advances',                  1),
    ('OTHER', 'OTHER',        'Other',                 'Anything not covered above',                  1)
  ) as x(type_code, code, name, description, seq)
  join public.acc_party_types t on t.type_code = x.type_code
  on conflict (property_id, sub_type_code) do nothing;
end;
$$;

do $$
declare
  p record;
begin
  for p in select id from public.properties loop
    perform public.acc_seed_default_party_sub_types(p.id);
  end loop;
end $$;

create or replace function public.acc_seed_party_sub_types_for_new_property()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.acc_seed_default_party_sub_types(new.id);
  return new;
end;
$$;

drop trigger if exists properties_seed_party_sub_types on public.properties;
create trigger properties_seed_party_sub_types
  after insert on public.properties
  for each row execute function public.acc_seed_party_sub_types_for_new_property();

notify pgrst, 'reload schema';

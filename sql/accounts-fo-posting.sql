-- Front Office → Accounts posting.
-- After Night Audit, the day's folio charges and front office payments are posted to Accounts
-- as one Journal Voucher per business date. Every ledger comes from the Accounts masters:
--   charge income  → Billing Point → Revenue Category → income ledger (division from the Billing Point)
--   charge tax     → tax lines saved on the charge → Tax Definition output ledger
--   payment        → Payment Method whose "Front Office payment mode" matches → its ledger
--   advance        → Company Settings → Guest Deposit ledger
--   guest balance  → Company Settings → Guest Ledger (new)
-- Run after accounts-schema.sql, accounts-tax-billing-points.sql and fo-night-audit-phase1.sql. Safe to re-run.

-- 1. Company settings: Guest Ledger + whether FO vouchers are created as Draft or Posted
alter table public.acc_company_settings
  add column if not exists default_guest_ledger_account_id uuid references public.acc_accounts(id) on delete set null;
alter table public.acc_company_settings
  add column if not exists fo_posting_status text not null default 'Draft';
alter table public.acc_company_settings drop constraint if exists acc_company_settings_fo_posting_status_check;
alter table public.acc_company_settings
  add constraint acc_company_settings_fo_posting_status_check check (fo_posting_status in ('Draft', 'Posted'));

-- Guest Ledger account (in-house guests who have not paid yet) under Trade Receivables
insert into public.acc_accounts (
  property_id, parent_id, code, name, account_type, nature, report_section, category, classification,
  allow_posting, is_system_account
)
select g.property_id, g.id, '1194', 'Guest Ledger - In-House', 'Ledger', 'Asset', 'Current Assets', 'Receivables',
       'Balance Sheet', true, true
  from public.acc_accounts g
 where g.code = '1190'
   and not exists (
     select 1 from public.acc_accounts a where a.property_id = g.property_id and a.code = '1194'
   );

update public.acc_company_settings s
   set default_guest_ledger_account_id = a.id
  from public.acc_accounts a
 where a.property_id = s.property_id
   and a.code = '1194'
   and s.default_guest_ledger_account_id is null;

-- 2. Division per billing point (tags the income line)
alter table public.acc_tax_applications
  add column if not exists division_id uuid references public.acc_divisions(id) on delete set null;

-- 3. Payment method ↔ Front Office payment mode (CASH, CARD, UPI, BANK_TRANSFER, CHEQUE, OTHER)
alter table public.acc_payment_methods add column if not exists fo_payment_mode text;
alter table public.acc_payment_methods drop constraint if exists acc_payment_methods_fo_payment_mode_check;
alter table public.acc_payment_methods
  add constraint acc_payment_methods_fo_payment_mode_check
  check (fo_payment_mode is null or fo_payment_mode in ('CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'));
create unique index if not exists acc_payment_methods_fo_mode_uidx
  on public.acc_payment_methods (property_id, fo_payment_mode)
  where fo_payment_mode is not null;

update public.acc_payment_methods m
   set fo_payment_mode = x.mode
  from (values ('CASH', 'CASH'), ('CARD', 'CARD'), ('UPI', 'UPI'), ('NEFT', 'BANK_TRANSFER'), ('CHQ', 'CHEQUE'))
       as x(code, mode)
 where m.payment_method_code = x.code
   and m.fo_payment_mode is null
   and not exists (
     select 1 from public.acc_payment_methods o
      where o.property_id = m.property_id and o.fo_payment_mode = x.mode
   );

-- 4. Where a voucher came from
alter table public.acc_vouchers add column if not exists source_type text not null default '';
alter table public.acc_vouchers add column if not exists source_ref text not null default '';
alter table public.acc_vouchers add column if not exists business_date date;
create index if not exists acc_vouchers_source_idx
  on public.acc_vouchers (property_id, source_module, source_type, business_date);

-- 5. Posted markers so nothing is posted twice (cleared again if the voucher is deleted or reversed)
alter table public.folio_charges add column if not exists acc_voucher_id uuid;
alter table public.transactions add column if not exists acc_voucher_id uuid;
alter table public.transactions add column if not exists acc_adjust_voucher_id uuid;

create index if not exists folio_charges_acc_unposted_idx
  on public.folio_charges (property_id, business_date)
  where acc_voucher_id is null;
create index if not exists transactions_acc_unposted_idx
  on public.transactions (property_id, transaction_date)
  where acc_voucher_id is null;

notify pgrst, 'reload schema';

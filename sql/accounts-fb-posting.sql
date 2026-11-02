-- F&B → Accounts posting.
-- Settled restaurant / bar bills (not charged to a room) are posted as one Journal Voucher per
-- business date, after Night Audit or from Accounts → F&B Posting:
--   Dr payment method ledger   Cr F&B income (billing point → revenue category)   Cr output tax
-- F&B payments reuse transactions.acc_voucher_id / acc_void_voucher_id.
--
-- Run after accounts-fo-posting.sql, accounts-fo-posting-phase2.sql and fb-property-scope.sql. Safe to re-run.

alter table public.fb_bills
  add column if not exists acc_voucher_id uuid references public.acc_vouchers(id) on delete set null;

create index if not exists fb_bills_acc_unposted_idx
  on public.fb_bills (property_id)
  where acc_voucher_id is null and payment_status = 'PAID';

create index if not exists transactions_fnb_source_idx
  on public.transactions (source_id)
  where source_module = 'FNB';

notify pgrst, 'reload schema';

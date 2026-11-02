-- Front Office → Accounts posting, phase 3.
--   1. Company on group bookings (master folio can be billed to the company).
--   2. Company bills: group / folio link, transfer entry on the folio, void details,
--      and a marker for voids posted to Accounts.
--
-- Run after accounts-fo-posting-phase2.sql. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Company on group bookings
-- ---------------------------------------------------------------------------
alter table public.fo_groups add column if not exists company_id text;
create index if not exists fo_groups_company_id_idx
  on public.fo_groups (company_id) where company_id is not null;

-- Existing groups: link by company name within the property.
update public.fo_groups g
set company_id = c.id::text
from public.companies c
where g.company_id is null
  and coalesce(trim(g.company_name), '') <> ''
  and c.property_id = g.property_id
  and lower(trim(c.name)) = lower(trim(g.company_name));

-- ---------------------------------------------------------------------------
-- 2. Company bills
-- ---------------------------------------------------------------------------
alter table public.fo_company_bills
  add column if not exists group_id text references public.fo_groups(id) on delete set null,
  add column if not exists folio_id text,
  add column if not exists transfer_transaction_id text,
  add column if not exists void_reason text not null default '',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text,
  add column if not exists acc_void_voucher_id uuid references public.acc_vouchers(id) on delete set null;

create index if not exists fo_company_bills_group_idx
  on public.fo_company_bills (group_id) where group_id is not null;
create index if not exists fo_company_bills_void_pending_idx
  on public.fo_company_bills (property_id)
  where status = 'Void' and acc_voucher_id is not null and acc_void_voucher_id is null;

notify pgrst, 'reload schema';

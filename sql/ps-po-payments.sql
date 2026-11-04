-- Payment record for direct purchase orders (POs not linked to a PR / RFQ).
-- payments: [{ id, paymentDate, amount, paymentMode, reference, paidBy, remarks }]
-- Safe to re-run.

alter table public.ps_purchase_orders
  add column if not exists payments jsonb not null default '[]'::jsonb,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists payment_status text not null default 'Unpaid';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ps_purchase_orders_payment_status_check'
  ) then
    alter table public.ps_purchase_orders
      add constraint ps_purchase_orders_payment_status_check
      check (payment_status in ('Unpaid', 'Partially Paid', 'Paid'));
  end if;
end $$;

create index if not exists ps_purchase_orders_payment_status_idx
  on public.ps_purchase_orders (payment_status);

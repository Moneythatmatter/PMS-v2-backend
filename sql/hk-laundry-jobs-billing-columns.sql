-- Minimal patch: add guest-laundry billing columns to hk_laundry_jobs
-- Run this alone in Supabase SQL Editor (safe to re-run).
-- Do NOT run housekeeping-schema.sql for this error.

alter table public.hk_laundry_jobs
  add column if not exists guest_phone text,
  add column if not exists folio_id text,
  add column if not exists booking_id text,
  add column if not exists guest_id text,
  add column if not exists urgency text default 'Normal',
  add column if not exists service_type text,
  add column if not exists expected_at timestamptz,
  add column if not exists subtotal numeric(14, 2) default 0,
  add column if not exists tax_amount numeric(14, 2) default 0,
  add column if not exists billing_status text not null default 'Unbilled',
  add column if not exists payment_mode text,
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled boolean not null default false,
  add column if not exists is_outsourced boolean not null default false,
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz default now();

create index if not exists hk_laundry_jobs_booking_id_idx
  on public.hk_laundry_jobs (booking_id)
  where booking_id is not null;

create index if not exists hk_laundry_jobs_billing_status_idx
  on public.hk_laundry_jobs (billing_status);

notify pgrst, 'reload schema';

-- Billing Points: pick which Tax Rules (tax + amount slab) apply at each billing point.
-- Empty tax_rule_ids → the revenue category's Tax Rules decide (old behaviour).
-- Non-empty          → exactly these rules apply, each within its own amount range.
-- Replaces the short-lived tax_ids column (GST picked directly), which is no longer read.
-- Run after accounts-tax-billing-points.sql. Safe to re-run.

alter table public.acc_tax_applications
  add column if not exists tax_rule_ids uuid[] not null default '{}';

alter table public.acc_tax_applications
  drop column if exists tax_ids;

notify pgrst, 'reload schema';

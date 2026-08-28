-- Remove F&B Settings module tables and module-record rows.
-- Run once in Supabase SQL Editor.

delete from public.fb_module_records
where module_key like 'settings/%';

drop table if exists public.fb_order_types cascade;
drop table if exists public.fb_payment_modes cascade;
drop table if exists public.fb_discounts cascade;
drop table if exists public.fb_taxes cascade;

notify pgrst, 'schema cache';

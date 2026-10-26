-- =============================================================================
-- Accounts — back-dated voucher limit by date (run once; safe to re-run).
--
--   back_dated_limit_mode = 'Days' → vouchers allowed back to today − back_dated_limit_days
--   back_dated_limit_mode = 'Date' → vouchers allowed on or after back_dated_from_date
-- =============================================================================

alter table public.acc_company_settings
  add column if not exists back_dated_limit_mode text not null default 'Days',
  add column if not exists back_dated_from_date date;

alter table public.acc_company_settings
  drop constraint if exists acc_company_settings_back_dated_limit_mode;
alter table public.acc_company_settings
  add constraint acc_company_settings_back_dated_limit_mode
  check (back_dated_limit_mode in ('Days', 'Date'));

notify pgrst, 'reload schema';

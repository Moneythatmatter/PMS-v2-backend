-- =============================================================================
-- Accounts — voucher lines v2 (run once on databases created with the original
-- accounts-schema.sql; fresh installs already get this shape). Safe to re-run.
--
--   * Each line is an entry type (Dr / Cr) + a single amount.
--     debit / credit stay as read-only generated columns so reports keep working.
--   * Line-level narration is removed (the voucher header narration is used).
--   * Lines may only post to ledgers that allow posting (never to groups).
--   * Line party_id is system-derived from the voucher party by the API.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'acc_voucher_lines' and column_name = 'entry_type'
  ) then
    alter table public.acc_voucher_lines
      add column entry_type text,
      add column amount numeric(18,2);

    update public.acc_voucher_lines
       set entry_type = case when debit > 0 then 'Dr' else 'Cr' end,
           amount = greatest(debit, credit);

    alter table public.acc_voucher_lines drop constraint if exists acc_voucher_lines_amount;
    alter table public.acc_voucher_lines drop column debit, drop column credit;

    alter table public.acc_voucher_lines
      alter column entry_type set not null,
      alter column amount set not null,
      add column debit numeric(18,2) generated always as (case when entry_type = 'Dr' then amount else 0 end) stored,
      add column credit numeric(18,2) generated always as (case when entry_type = 'Cr' then amount else 0 end) stored,
      add constraint acc_voucher_lines_entry_type check (entry_type in ('Dr', 'Cr')),
      add constraint acc_voucher_lines_amount check (amount > 0) not valid;
  end if;
end $$;

alter table public.acc_voucher_lines drop column if exists narration;

create or replace function public.acc_voucher_lines_ledger_only()
returns trigger language plpgsql as $$
declare
  v_type text;
  v_posting boolean;
  v_name text;
begin
  select account_type, allow_posting, name into v_type, v_posting, v_name
    from public.acc_accounts where id = new.account_id;
  if v_type is distinct from 'Ledger' or not coalesce(v_posting, false) then
    raise exception '% is a group / non-posting account — voucher lines must use a ledger',
      coalesce(v_name, new.account_id::text)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists acc_voucher_lines_ledger_only on public.acc_voucher_lines;
create trigger acc_voucher_lines_ledger_only
  before insert or update of account_id on public.acc_voucher_lines
  for each row execute function public.acc_voucher_lines_ledger_only();

notify pgrst, 'reload schema';

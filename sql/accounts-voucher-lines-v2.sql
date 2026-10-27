-- =============================================================================
-- Accounts — voucher lines v2 (run once on databases created with the original
-- accounts-schema.sql; fresh installs already get this shape). Safe to re-run.
--
--   * Each line is an entry type (Dr / Cr) + a single amount.
--     debit / credit stay as read-only generated columns so reports keep working.
--   * Lines may only post to ledgers that allow posting (never to groups).
--   * Line party_id is system-derived from the voucher party by the API.
-- =============================================================================

-- Each piece (entry_type, amount, generated debit/credit) is checked separately,
-- so partially migrated tables are completed instead of skipped.
do $$
declare
  v_has_entry boolean;
  v_has_amount boolean;
  v_debit_gen text;   -- null = column missing, 'ALWAYS' = generated, 'NEVER' = plain
  v_credit_gen text;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'acc_voucher_lines'
                    and column_name = 'entry_type') into v_has_entry;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'acc_voucher_lines'
                    and column_name = 'amount') into v_has_amount;
  select is_generated into v_debit_gen from information_schema.columns
   where table_schema = 'public' and table_name = 'acc_voucher_lines' and column_name = 'debit';
  select is_generated into v_credit_gen from information_schema.columns
   where table_schema = 'public' and table_name = 'acc_voucher_lines' and column_name = 'credit';

  if not v_has_entry then
    alter table public.acc_voucher_lines add column entry_type text;
  end if;
  if not v_has_amount then
    alter table public.acc_voucher_lines add column amount numeric(18,2);
  end if;

  -- Backfill from the legacy plain debit / credit columns, then drop them.
  if v_debit_gen = 'NEVER' or v_credit_gen = 'NEVER' then
    execute format(
      'update public.acc_voucher_lines set
         entry_type = coalesce(entry_type, case when coalesce(%1$s, 0) > 0 then ''Dr'' else ''Cr'' end),
         amount     = coalesce(amount, greatest(coalesce(%1$s, 0), coalesce(%2$s, 0)))',
      case when v_debit_gen = 'NEVER' then 'debit' else '0' end,
      case when v_credit_gen = 'NEVER' then 'credit' else '0' end
    );
    alter table public.acc_voucher_lines drop constraint if exists acc_voucher_lines_amount;
    if v_debit_gen = 'NEVER' then
      alter table public.acc_voucher_lines drop column debit;
      v_debit_gen := null;
    end if;
    if v_credit_gen = 'NEVER' then
      alter table public.acc_voucher_lines drop column credit;
      v_credit_gen := null;
    end if;
  end if;

  update public.acc_voucher_lines set entry_type = 'Dr' where entry_type is null;
  update public.acc_voucher_lines set amount = 0 where amount is null;

  alter table public.acc_voucher_lines
    alter column entry_type set not null,
    alter column amount set not null;

  if v_debit_gen is null then
    alter table public.acc_voucher_lines
      add column debit numeric(18,2)
        generated always as (case when entry_type = 'Dr' then amount else 0 end) stored;
  end if;
  if v_credit_gen is null then
    alter table public.acc_voucher_lines
      add column credit numeric(18,2)
        generated always as (case when entry_type = 'Cr' then amount else 0 end) stored;
  end if;

  alter table public.acc_voucher_lines drop constraint if exists acc_voucher_lines_entry_type;
  alter table public.acc_voucher_lines
    add constraint acc_voucher_lines_entry_type check (entry_type in ('Dr', 'Cr'));
  alter table public.acc_voucher_lines drop constraint if exists acc_voucher_lines_amount;
  alter table public.acc_voucher_lines
    add constraint acc_voucher_lines_amount check (amount > 0) not valid;
end $$;

alter table public.acc_voucher_lines add column if not exists narration text not null default '';

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

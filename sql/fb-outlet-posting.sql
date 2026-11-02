-- =============================================================================
-- F&B outlet-wise traceability in Accounts posting.
--
--   1. fb_bills.outlet_id and transactions.outlet_id (F&B rows only), stamped by triggers
--      on insert so every write path (POS pay, Room Charge RPCs, legacy pay) records it,
--      plus a backfill of existing rows.
--   2. acc_outlet_posting_rules: per outlet (optionally per billing point) the Accounts
--      division (revenue centre), an optional income ledger override and an optional cash
--      ledger override. F&B Posting and Front Office Posting (room service charged to a room)
--      use these; outlets without a rule keep the billing-point defaults.
--   3. acc_mark_posted_batch(): marks every posted source row in one database transaction,
--      all or nothing.
--
-- Run after accounts-fb-posting.sql and fb-cashier-day-close.sql. Safe to re-run.
-- =============================================================================

-- 1. Outlet on bills and F&B transactions -------------------------------------

alter table public.fb_bills     add column if not exists outlet_id text;
alter table public.transactions add column if not exists outlet_id text;

create or replace function public.fb_bills_fill_outlet()
returns trigger
language plpgsql
as $$
begin
  if new.outlet_id is null and new.order_id is not null then
    select o.outlet_id into new.outlet_id from public.fb_orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fb_bills_fill_outlet on public.fb_bills;
create trigger trg_fb_bills_fill_outlet
  before insert or update of order_id on public.fb_bills
  for each row
  execute function public.fb_bills_fill_outlet();

-- An F&B transaction's source_id is the bill (POS, room charge) or the order (legacy pay).
create or replace function public.transactions_fill_fnb_outlet()
returns trigger
language plpgsql
as $$
begin
  if new.outlet_id is null
     and new.source_module = 'FNB'::public.transaction_source_module
     and new.source_id is not null then
    select coalesce(b.outlet_id, o.outlet_id) into new.outlet_id
      from public.fb_bills b
      left join public.fb_orders o on o.id = b.order_id
     where b.id = new.source_id;
    if new.outlet_id is null then
      select o.outlet_id into new.outlet_id from public.fb_orders o where o.id = new.source_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_fill_fnb_outlet on public.transactions;
create trigger trg_transactions_fill_fnb_outlet
  before insert on public.transactions
  for each row
  execute function public.transactions_fill_fnb_outlet();

-- Backfill (updated_at is left alone on transactions).
update public.fb_bills b
   set outlet_id = o.outlet_id
  from public.fb_orders o
 where o.id = b.order_id
   and b.outlet_id is null;

alter table public.transactions disable trigger trg_transactions_set_updated_at;

update public.transactions t
   set outlet_id = coalesce(b.outlet_id, o.outlet_id)
  from public.fb_bills b
  left join public.fb_orders o on o.id = b.order_id
 where t.source_module = 'FNB'::public.transaction_source_module
   and t.outlet_id is null
   and b.id = t.source_id;

update public.transactions t
   set outlet_id = o.outlet_id
  from public.fb_orders o
 where t.source_module = 'FNB'::public.transaction_source_module
   and t.outlet_id is null
   and o.id = t.source_id;

alter table public.transactions enable trigger trg_transactions_set_updated_at;

create index if not exists idx_fb_bills_outlet on public.fb_bills (outlet_id);
create index if not exists idx_transactions_fnb_outlet
  on public.transactions (outlet_id, transaction_date)
  where source_module = 'FNB'::public.transaction_source_module;

-- 2. Outlet posting rules -------------------------------------------------------

create table if not exists public.acc_outlet_posting_rules (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  outlet_id text not null references public.fb_outlets(id) on delete cascade,
  -- null = every F&B billing point of the outlet; FB_RESTAURANT_BILL / FB_ROOM_SERVICE = only that one
  billing_point text check (billing_point is null or billing_point in ('FB_RESTAURANT_BILL', 'FB_ROOM_SERVICE')),
  division_id uuid references public.acc_divisions(id) on delete set null,
  income_account_id uuid references public.acc_accounts(id) on delete set null,
  cash_account_id uuid references public.acc_accounts(id) on delete set null,
  remarks text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists acc_outlet_posting_rules_unique
  on public.acc_outlet_posting_rules (property_id, outlet_id, coalesce(billing_point, '*'));

alter table public.acc_outlet_posting_rules enable row level security;
drop policy if exists "anon_all_acc_outlet_posting_rules" on public.acc_outlet_posting_rules;
create policy "anon_all_acc_outlet_posting_rules" on public.acc_outlet_posting_rules
  for all to anon using (true) with check (true);

-- 3. Atomic "mark as posted" ----------------------------------------------------
-- p_targets: [{ "table": "fb_bills", "column": "acc_voucher_id", "ids": ["..."] }, ...]
-- Every listed row must still be unposted; otherwise nothing is marked and it raises.

create or replace function public.acc_mark_posted_batch(
  p_property_id text,
  p_voucher_id uuid,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_target jsonb;
  v_table text;
  v_column text;
  v_ids text[];
  v_count int;
  v_total int := 0;
begin
  for v_target in select * from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) loop
    v_table := v_target->>'table';
    v_column := v_target->>'column';
    select coalesce(array_agg(x), '{}') into v_ids from jsonb_array_elements_text(v_target->'ids') x;
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      continue;
    end if;
    if v_table not in ('fb_bills', 'transactions', 'folio_charges', 'fo_company_bills') then
      raise exception 'acc_mark_posted_batch: table % is not allowed', v_table;
    end if;
    if v_column not in ('acc_voucher_id', 'acc_void_voucher_id', 'acc_adjust_voucher_id') then
      raise exception 'acc_mark_posted_batch: column % is not allowed', v_column;
    end if;

    execute format(
      'update public.%I set %I = $1 where property_id = $2 and id::text = any($3) and %I is null',
      v_table, v_column, v_column
    ) using p_voucher_id, p_property_id, v_ids;
    get diagnostics v_count = row_count;

    if v_count <> array_length(v_ids, 1) then
      raise exception 'ALREADY_POSTED: % of % %.% rows were already posted', array_length(v_ids, 1) - v_count, array_length(v_ids, 1), v_table, v_column
        using errcode = 'P0001';
    end if;
    v_total := v_total + v_count;
  end loop;
  return jsonb_build_object('marked', v_total);
end;
$$;

grant execute on function public.acc_mark_posted_batch(text, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

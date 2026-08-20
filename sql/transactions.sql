-- Unified PMS transactions (payments, refunds, adjustments)
-- Run once in Supabase SQL Editor after front-office-schema.sql and auth-users-schema.sql
--
-- Covers: Front Office checkout/advance, F&B orders, reservation deposits, etc.
-- booking_id → reservations.id · guest_id → guests.id · folio_id → folios.id
-- source_module + source_id optional (e.g. FNB order without guest folio)
--
-- Reference fields:
--   transaction_number  — system id (TXN-00001), unique, auto-assigned
--   external_reference  — optional UPI / card / bank ref from guest payment

create extension if not exists pgcrypto;

-- ========== ENUMS ==========

do $$
begin
  create type public.transaction_type as enum (
    'PAYMENT',
    'REFUND',
    'ADJUSTMENT'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_method as enum (
    'CASH',
    'CARD',
    'UPI',
    'BANK_TRANSFER',
    'CHEQUE',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_status as enum (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'VOIDED',
    'REFUNDED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.transaction_source_module as enum (
    'FRONT_OFFICE',
    'FNB',
    'RESERVATION',
    'HOUSEKEEPING',
    'MAINTENANCE',
    'ACCOUNTS',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.folio_status as enum (
    'OPEN',
    'CLOSED',
    'VOID'
  );
exception
  when duplicate_object then null;
end $$;

-- ========== FOLIOS (guest account / billing bucket) ==========

create sequence if not exists public.folios_folio_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.folios (
  id text primary key default gen_random_uuid()::text,
  folio_number text,

  booking_id text references public.reservations(id) on delete set null,
  guest_id text references public.guests(id) on delete set null,

  status public.folio_status not null default 'OPEN',
  currency char(3) not null default 'INR',

  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  balance_amount numeric(14, 2) not null default 0,

  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists folios_folio_number_key
  on public.folios (folio_number)
  where folio_number is not null and trim(folio_number) <> '';

create index if not exists folios_booking_id_idx
  on public.folios (booking_id)
  where booking_id is not null;

create index if not exists folios_guest_id_idx
  on public.folios (guest_id)
  where guest_id is not null;

create index if not exists folios_status_idx
  on public.folios (status);

-- Upgrade: slim folios from early transactions.sql (balance / notes columns)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'folios' and column_name = 'balance'
  ) then
    alter table public.folios add column if not exists subtotal numeric(14, 2) not null default 0;
    alter table public.folios add column if not exists tax_total numeric(14, 2) not null default 0;
    alter table public.folios add column if not exists discount_total numeric(14, 2) not null default 0;
    alter table public.folios add column if not exists total_amount numeric(14, 2) not null default 0;
    alter table public.folios add column if not exists paid_amount numeric(14, 2) not null default 0;
    alter table public.folios add column if not exists balance_amount numeric(14, 2) not null default 0;

    update public.folios
    set balance_amount = coalesce(balance, 0)
    where balance_amount = 0 and coalesce(balance, 0) <> 0;

    alter table public.folios drop column if exists balance;
    alter table public.folios drop column if exists notes;
  end if;
end $$;

-- Fresh installs / partial patches: ensure amount columns exist
alter table public.folios add column if not exists subtotal numeric(14, 2) not null default 0;
alter table public.folios add column if not exists tax_total numeric(14, 2) not null default 0;
alter table public.folios add column if not exists discount_total numeric(14, 2) not null default 0;
alter table public.folios add column if not exists total_amount numeric(14, 2) not null default 0;
alter table public.folios add column if not exists paid_amount numeric(14, 2) not null default 0;
alter table public.folios add column if not exists balance_amount numeric(14, 2) not null default 0;

-- Keep balance_amount in sync with totals when header fields change
create or replace function public.folios_recalc_balance()
returns trigger
language plpgsql
as $$
begin
  new.total_amount := greatest(
    0,
    coalesce(new.subtotal, 0) + coalesce(new.tax_total, 0) - coalesce(new.discount_total, 0)
  );
  new.balance_amount := greatest(0, coalesce(new.total_amount, 0) - coalesce(new.paid_amount, 0));
  return new;
end;
$$;

drop trigger if exists trg_folios_recalc_balance on public.folios;
create trigger trg_folios_recalc_balance
  before insert or update of subtotal, tax_total, discount_total, paid_amount, total_amount
  on public.folios
  for each row
  execute function public.folios_recalc_balance();

-- ========== TRANSACTIONS ==========

create sequence if not exists public.transactions_transaction_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists public.transactions (
  id text primary key default gen_random_uuid()::text, -- UUID v4 only (see trg_transactions_enforce_uuid_pk)
  transaction_number text not null,

  transaction_type public.transaction_type not null default 'PAYMENT',
  payment_method public.payment_method not null default 'CASH',
  amount numeric(14, 2) not null check (amount >= 0),
  currency char(3) not null default 'INR',
  status public.transaction_status not null default 'COMPLETED',

  folio_id text references public.folios(id) on delete set null,
  booking_id text references public.reservations(id) on delete set null,
  guest_id text references public.guests(id) on delete set null,

  source_module public.transaction_source_module,
  source_id text,

  external_reference text,

  received_by text references public.users(id) on delete set null,

  transaction_date timestamptz not null default now(),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transactions_transaction_number_key
  on public.transactions (transaction_number);

create index if not exists transactions_folio_id_idx
  on public.transactions (folio_id)
  where folio_id is not null;

create index if not exists transactions_booking_id_idx
  on public.transactions (booking_id)
  where booking_id is not null;

create index if not exists transactions_guest_id_idx
  on public.transactions (guest_id)
  where guest_id is not null;

create index if not exists transactions_source_idx
  on public.transactions (source_module, source_id)
  where source_module is not null;

create index if not exists transactions_status_idx
  on public.transactions (status);

create index if not exists transactions_transaction_date_idx
  on public.transactions (transaction_date desc);

create index if not exists transactions_external_reference_idx
  on public.transactions (external_reference)
  where external_reference is not null and trim(external_reference) <> '';

-- PK must always be UUID v4 (human-readable codes live in transaction_number)
create or replace function public.is_uuid_v4(p_value text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    false
  );
$$;

create or replace function public.transactions_enforce_uuid_pk()
returns trigger
language plpgsql
as $$
begin
  if new.id is null or trim(new.id) = '' or not public.is_uuid_v4(new.id) then
    new.id := gen_random_uuid()::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_enforce_uuid_pk on public.transactions;
create trigger trg_transactions_enforce_uuid_pk
  before insert on public.transactions
  for each row
  execute function public.transactions_enforce_uuid_pk();


create or replace function public.map_legacy_payment_method(p_mode text)
returns public.payment_method
language plpgsql
immutable
as $$
begin
  case upper(trim(coalesce(p_mode, '')))
    when 'CASH' then return 'CASH'::public.payment_method;
    when 'CARD', 'CREDIT CARD', 'DEBIT CARD', 'CREDIT_CARD', 'DEBIT_CARD' then
      return 'CARD'::public.payment_method;
    when 'UPI', 'GPAY', 'GOOGLE PAY', 'PHONEPE', 'PAYTM' then
      return 'UPI'::public.payment_method;
    when 'BANK TRANSFER', 'BANK_TRANSFER', 'NEFT', 'RTGS', 'IMPS' then
      return 'BANK_TRANSFER'::public.payment_method;
    when 'CHEQUE', 'CHECK' then return 'CHEQUE'::public.payment_method;
    else return 'OTHER'::public.payment_method;
  end case;
end;
$$;

create or replace function public.map_legacy_payment_status(p_status text)
returns public.transaction_status
language plpgsql
immutable
as $$
begin
  case upper(trim(coalesce(p_status, '')))
    when 'PENDING' then return 'PENDING'::public.transaction_status;
    when 'FAILED' then return 'FAILED'::public.transaction_status;
    when 'VOID', 'VOIDED' then return 'VOIDED'::public.transaction_status;
    when 'REFUNDED' then return 'REFUNDED'::public.transaction_status;
    else return 'COMPLETED'::public.transaction_status;
  end case;
end;
$$;

create or replace function public.map_legacy_payment_type(p_type text)
returns public.transaction_type
language plpgsql
immutable
as $$
begin
  case upper(trim(coalesce(p_type, '')))
    when 'REFUND' then return 'REFUND'::public.transaction_type;
    when 'ADJUSTMENT', 'ADJUST' then return 'ADJUSTMENT'::public.transaction_type;
    else return 'PAYMENT'::public.transaction_type;
  end case;
end;
$$;

create or replace function public.folios_assign_folio_number()
returns trigger
language plpgsql
as $$
begin
  if new.folio_number is null or trim(new.folio_number) = '' then
    new.folio_number := 'FOL-' || lpad(
      (nextval('public.folios_folio_number_seq') + 1)::text,
      3,
      '0'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_folios_assign_folio_number on public.folios;
create trigger trg_folios_assign_folio_number
  before insert on public.folios
  for each row
  execute function public.folios_assign_folio_number();

create or replace function public.folios_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_folios_set_updated_at on public.folios;
create trigger trg_folios_set_updated_at
  before update on public.folios
  for each row
  execute function public.folios_set_updated_at();

create or replace function public.transactions_assign_transaction_number()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_number is null or trim(new.transaction_number) = '' then
    new.transaction_number := 'TXN-' || lpad(
      (nextval('public.transactions_transaction_number_seq') + 1)::text,
      5,
      '0'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_assign_transaction_number on public.transactions;
create trigger trg_transactions_assign_transaction_number
  before insert on public.transactions
  for each row
  execute function public.transactions_assign_transaction_number();

create or replace function public.transactions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_transactions_set_updated_at on public.transactions;
create trigger trg_transactions_set_updated_at
  before update on public.transactions
  for each row
  execute function public.transactions_set_updated_at();

-- When a completed payment/refund hits a folio, roll paid_amount + balance_amount
create or replace function public.transactions_sync_folio_amounts()
returns trigger
language plpgsql
as $$
declare
  v_delta numeric(14, 2) := 0;
begin
  if new.folio_id is null or trim(new.folio_id) = '' then
    return new;
  end if;
  if new.status <> 'COMPLETED'::public.transaction_status then
    return new;
  end if;

  if new.transaction_type = 'PAYMENT'::public.transaction_type then
    v_delta := coalesce(new.amount, 0);
  elsif new.transaction_type = 'REFUND'::public.transaction_type then
    v_delta := -coalesce(new.amount, 0);
  else
    return new;
  end if;

  update public.folios f
  set paid_amount = greatest(0, coalesce(f.paid_amount, 0) + v_delta)
  where f.id = new.folio_id;

  return new;
end;
$$;

drop trigger if exists trg_transactions_sync_folio_amounts on public.transactions;
create trigger trg_transactions_sync_folio_amounts
  after insert on public.transactions
  for each row
  execute function public.transactions_sync_folio_amounts();

-- Open or reuse folio for a reservation (in-house guest billing)
create or replace function public.sync_folio_from_booking(
  p_booking_id text,
  p_folio_id text
)
returns void
language plpgsql
security definer
as $$
declare
  v_subtotal numeric(14, 2);
  v_paid numeric(14, 2);
  v_folio_subtotal numeric(14, 2);
  v_folio_paid numeric(14, 2);
begin
  select
    coalesce(r.total_amount, 0),
    coalesce(r.advance_paid, 0)
  into v_subtotal, v_paid
  from public.reservations r
  where r.id = p_booking_id;

  if not found then
    return;
  end if;

  select coalesce(f.subtotal, 0), coalesce(f.paid_amount, 0)
  into v_folio_subtotal, v_folio_paid
  from public.folios f
  where f.id = p_folio_id;

  if not found then
    return;
  end if;

  -- Only seed empty folios from reservation (avoid overwriting transaction-synced totals)
  if v_folio_subtotal = 0 and v_subtotal > 0 then
    update public.folios
    set subtotal = v_subtotal
    where id = p_folio_id;
  end if;

  if v_folio_paid = 0 and v_paid > 0 then
    update public.folios
    set paid_amount = v_paid
    where id = p_folio_id;
  end if;
end;
$$;

create or replace function public.ensure_folio_for_booking(
  p_booking_id text,
  p_guest_id text default null
)
returns text
language plpgsql
security definer
as $$
declare
  v_folio_id text;
  v_guest_id text;
  v_status public.folio_status;
  v_subtotal numeric(14, 2) := 0;
  v_paid numeric(14, 2) := 0;
  v_res_status text;
begin
  if p_booking_id is null or trim(p_booking_id) = '' then
    raise exception 'booking_id is required' using errcode = 'P0001';
  end if;

  select id into v_folio_id
  from public.folios
  where booking_id = p_booking_id
    and status = 'OPEN'::public.folio_status
  order by opened_at desc
  limit 1;

  if v_folio_id is not null then
    perform public.sync_folio_from_booking(p_booking_id, v_folio_id);
    return v_folio_id;
  end if;

  select
    coalesce(nullif(trim(p_guest_id), ''), r.guest_id),
    r.status,
    coalesce(r.total_amount, 0),
    coalesce(r.advance_paid, 0)
  into v_guest_id, v_res_status, v_subtotal, v_paid
  from public.reservations r
  where r.id = p_booking_id;

  v_status := case
    when coalesce(v_res_status, '') in ('Checked Out', 'Cancelled', 'No Show')
      then 'CLOSED'::public.folio_status
    else 'OPEN'::public.folio_status
  end;

  insert into public.folios (
    booking_id,
    guest_id,
    status,
    currency,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    paid_amount,
    balance_amount
  )
  values (
    p_booking_id,
    v_guest_id,
    v_status,
    'INR',
    v_subtotal,
    0,
    0,
    v_subtotal,
    v_paid,
    greatest(0, v_subtotal - v_paid)
  )
  returning id into v_folio_id;

  return v_folio_id;
end;
$$;

-- Placeholder ref when staff have not entered UPI/card/bank id (no payment gateway yet)
create or replace function public.generate_external_reference()
returns text
language sql
volatile
as $$
  select 'REF-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 10));
$$;

create or replace function public.transactions_default_external_reference()
returns trigger
language plpgsql
as $$
begin
  if new.external_reference is null or trim(new.external_reference) = '' then
    if new.payment_method <> 'CASH'::public.payment_method then
      new.external_reference := public.generate_external_reference();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_default_external_reference on public.transactions;
create trigger trg_transactions_default_external_reference
  before insert on public.transactions
  for each row
  execute function public.transactions_default_external_reference();

-- Record a payment/refund/adjustment (used by FO checkout, F&B cashier, reservation advance)
drop function if exists public.record_transaction(
  numeric,
  public.transaction_type,
  public.payment_method,
  char,
  public.transaction_status,
  text,
  text,
  text,
  public.transaction_source_module,
  text,
  text,
  text,
  text,
  timestamptz,
  text
);

create or replace function public.record_transaction(
  p_amount numeric,
  p_transaction_type public.transaction_type default 'PAYMENT',
  p_payment_method public.payment_method default 'CASH',
  p_currency char(3) default 'INR',
  p_status public.transaction_status default 'COMPLETED',
  p_folio_id text default null,
  p_booking_id text default null,
  p_guest_id text default null,
  p_source_module public.transaction_source_module default null,
  p_source_id text default null,
  p_external_reference text default null,
  p_received_by text default null,
  p_transaction_date timestamptz default now(),
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.transactions%rowtype;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be >= 0' using errcode = 'P0001';
  end if;

  insert into public.transactions (
    transaction_type,
    payment_method,
    amount,
    currency,
    status,
    folio_id,
    booking_id,
    guest_id,
    source_module,
    source_id,
    external_reference,
    received_by,
    transaction_date,
    notes
  ) values (
    p_transaction_type,
    p_payment_method,
    p_amount,
    coalesce(nullif(trim(p_currency), ''), 'INR'),
    p_status,
    nullif(trim(p_folio_id), ''),
    nullif(trim(p_booking_id), ''),
    nullif(trim(p_guest_id), ''),
    p_source_module,
    nullif(trim(p_source_id), ''),
    case
      when nullif(trim(p_external_reference), '') is not null
        then nullif(trim(p_external_reference), '')
      when p_payment_method = 'CASH'::public.payment_method
        then null
      else public.generate_external_reference()
    end,
    nullif(trim(p_received_by), ''),
    coalesce(p_transaction_date, now()),
    nullif(trim(p_notes), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.generate_external_reference() to anon, authenticated;
grant execute on function public.sync_folio_from_booking(text, text) to anon, authenticated;
grant execute on function public.ensure_folio_for_booking(text, text) to anon, authenticated;
grant execute on function public.record_transaction(
  numeric,
  public.transaction_type,
  public.payment_method,
  char,
  public.transaction_status,
  text,
  text,
  text,
  public.transaction_source_module,
  text,
  text,
  text,
  timestamptz,
  text
) to anon, authenticated;

-- ========== MIGRATE legacy payments → transactions ==========

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payments'
  ) then
    insert into public.transactions (
      transaction_number,
      transaction_type,
      payment_method,
      amount,
      currency,
      status,
      booking_id,
      guest_id,
      source_module,
      external_reference,
      transaction_date,
      notes,
      created_at
    )
    select
      coalesce(nullif(trim(p.transaction_no), ''), nullif(trim(p.id), '')),
      public.map_legacy_payment_type(p.type),
      public.map_legacy_payment_method(p.mode),
      coalesce(p.amount, 0),
      'INR',
      public.map_legacy_payment_status(p.status),
      nullif(trim(p.reservation_id), ''),
      (
        select r.guest_id
        from public.reservations r
        where r.id = p.reservation_id
        limit 1
      ),
      'FRONT_OFFICE'::public.transaction_source_module,
      case
        when coalesce(p.transaction_no, '') ~* '^(TXN|PAY)-' then null
        else nullif(trim(p.transaction_no), '')
      end,
      coalesce(
        case
          when p.date ~ '^\d{4}-\d{2}-\d{2}' then p.date::timestamptz
          else null
        end,
        p.created_at,
        now()
      ),
      concat_ws(
        ' · ',
        'Legacy payment',
        nullif(trim(p.id), ''),
        nullif(trim(p.guest_name), ''),
        nullif(trim(p.room), '')
      ),
      coalesce(p.created_at, now())
    from public.payments p
    where not exists (
      select 1
      from public.transactions t
      where t.transaction_number = coalesce(nullif(trim(p.transaction_no), ''), nullif(trim(p.id), ''))
         or (t.notes is not null and t.notes like '%' || p.id || '%')
    );
  end if;
end $$;

-- Repair rows that used legacy PAY-* / TXN-* strings as primary key
do $$
declare
  r record;
  v_new_id text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) then
    return;
  end if;

  for r in
    select id
    from public.transactions
    where not public.is_uuid_v4(id)
  loop
    v_new_id := gen_random_uuid()::text;

    update public.transactions
    set
      transaction_number = coalesce(nullif(trim(transaction_number), ''), r.id),
      notes = trim(
        both from concat_ws(
          ' · ',
          nullif(trim(notes), ''),
          'Legacy payment id: ' || r.id
        )
      )
    where id = r.id;

    update public.transactions
    set id = v_new_id
    where id = r.id;
  end loop;
end $$;

-- ========== ONE-TIME: folios for all bookings + seed transactions.folio_id & external_reference ==========

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reservations'
  ) then
    return;
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'folios'
  ) then
    return;
  end if;

  -- Create folio for every reservation that does not have one
  insert into public.folios (
    booking_id,
    guest_id,
    status,
    currency,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    paid_amount,
    balance_amount,
    opened_at
  )
  select
    r.id,
    r.guest_id,
    case
      when coalesce(r.status, '') in ('Checked Out', 'Cancelled', 'No Show')
        then 'CLOSED'::public.folio_status
      else 'OPEN'::public.folio_status
    end,
    'INR',
    coalesce(r.total_amount, 0),
    0,
    0,
    coalesce(r.total_amount, 0),
    coalesce(r.advance_paid, 0),
    greatest(
      0,
      coalesce(r.total_amount, 0) - coalesce(r.advance_paid, 0)
    ),
    coalesce(
      case
        when r.created_at ~ '^\d{4}-\d{2}-\d{2}' then r.created_at::timestamptz
        else null
      end,
      now()
    )
  from public.reservations r
  where not exists (
    select 1
    from public.folios f
    where f.booking_id = r.id
  );

  -- Link existing transactions to their booking folio
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) then
    update public.transactions t
    set folio_id = (
      select f.id
      from public.folios f
      where f.booking_id = t.booking_id
      order by
        case when f.status = 'OPEN'::public.folio_status then 0 else 1 end,
        f.opened_at desc
      limit 1
    )
    where t.folio_id is null
      and t.booking_id is not null
      and trim(t.booking_id) <> ''
      and exists (
        select 1
        from public.folios f
        where f.booking_id = t.booking_id
      );

    -- Seed external_reference from legacy payments (UPI / card / bank refs — not TXN-* / PAY-*)
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'payments'
    ) then
      update public.transactions t
      set external_reference = nullif(trim(p.transaction_no), '')
      from public.payments p
      where (t.external_reference is null or trim(t.external_reference) = '')
        and nullif(trim(p.reservation_id), '') = t.booking_id
        and p.transaction_no is not null
        and trim(p.transaction_no) <> ''
        and p.transaction_no !~* '^(TXN|PAY)-'
        and (
          t.transaction_number = coalesce(nullif(trim(p.transaction_no), ''), nullif(trim(p.id), ''))
          or (t.notes is not null and t.notes like '%' || p.id || '%')
          or (
            t.amount = p.amount
            and coalesce(t.payment_method::text, '') = public.map_legacy_payment_method(p.mode)::text
          )
        );
    end if;

    -- Seed external_reference from deprecated reference_number column (pre-drop)
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'transactions'
        and column_name = 'reference_number'
    ) then
      update public.transactions
      set external_reference = reference_number
      where (external_reference is null or trim(external_reference) = '')
        and reference_number is not null
        and trim(reference_number) <> ''
        and reference_number !~* '^(TXN|PAY)-';
    end if;

    -- Clear internal ids wrongly stored as external_reference
    update public.transactions
    set external_reference = null
    where external_reference is not null
      and (
        external_reference ~* '^(TXN|PAY)'
        or trim(external_reference) = trim(transaction_number)
      );

    -- Placeholder external_reference until staff enter real UPI/card/bank ref manually
    update public.transactions t
    set external_reference = 'REF-' || upper(substr(md5(t.id || coalesce(t.transaction_number, '')), 1, 10))
    where external_reference is null
      or trim(external_reference) = '';
  end if;
exception
  when others then
    raise notice 'folios + transactions.folio_id/external_reference one-time seed: %', sqlerrm;
end $$;

-- Remove deprecated RPC if it was created in an earlier run
drop function if exists public.backfill_missing_folios();

-- ========== DROP reference_number — use transaction_number + external_reference only ==========

do $$
declare
  r record;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'reference_number'
  ) then
    -- Internal codes (TXN-*, PAY-*) → transaction_number when missing
    update public.transactions
    set transaction_number = reference_number
    where (transaction_number is null or trim(transaction_number) = '')
      and reference_number is not null
      and trim(reference_number) <> ''
      and reference_number ~* '^(TXN|PAY)-';

    -- UPI / card / bank refs → external_reference
    update public.transactions
    set external_reference = reference_number
    where (external_reference is null or trim(external_reference) = '')
      and reference_number is not null
      and trim(reference_number) <> ''
      and reference_number !~* '^(TXN|PAY)-';

    alter table public.transactions drop column reference_number;
  end if;

  -- Backfill missing transaction_number before NOT NULL
  for r in
    select id
    from public.transactions
    where transaction_number is null or trim(transaction_number) = ''
  loop
    update public.transactions
    set transaction_number = 'TXN-' || lpad(
      (nextval('public.transactions_transaction_number_seq') + 1)::text,
      5,
      '0'
    )
    where id = r.id;
  end loop;

  alter table public.transactions
    alter column transaction_number set not null;
exception
  when others then
    raise notice 'transactions reference_number migration: %', sqlerrm;
end $$;

-- ========== RLS ==========

alter table public.folios enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "anon_all_folios" on public.folios;
create policy "anon_all_folios" on public.folios
  for all to anon
  using (true)
  with check (true);

drop policy if exists "anon_all_transactions" on public.transactions;
create policy "anon_all_transactions" on public.transactions
  for all to anon
  using (true)
  with check (true);

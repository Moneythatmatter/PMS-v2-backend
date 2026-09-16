-- Room Service settlement: source_type + atomic Room Charge / reversal RPCs.
-- Run in Supabase before deploying backend changes.

alter table public.transactions add column if not exists source_type text;

create index if not exists transactions_source_type_idx
  on public.transactions (source_module, source_type, source_id, folio_id)
  where source_module is not null
    and source_type is not null
    and source_id is not null;

-- One initial Room Service folio charge per bill + folio (reversals use ROOM_SERVICE_REVERSAL).
create unique index if not exists transactions_fnb_room_service_charge_uidx
  on public.transactions (source_module, source_type, source_id, folio_id)
  where source_module = 'FNB'::public.transaction_source_module
    and source_type = 'ROOM_SERVICE'
    and transaction_type = 'ADJUSTMENT'::public.transaction_type
    and status = 'COMPLETED'::public.transaction_status;

-- Extend record_transaction (p_source_type optional, backward compatible).
-- Create the 16-arg version first so we never leave the DB without a callable RPC.
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
  p_notes text default null,
  p_source_type text default null
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
    source_type,
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
    nullif(trim(p_source_type), ''),
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

-- Remove legacy 15-arg overload (keep the new 16-arg version above).
do $$
declare
  r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_transaction'
      and pg_get_function_identity_arguments(p.oid) not like '%source_type%'
  loop
    execute format('drop function if exists public.record_transaction(%s)', r.args);
  end loop;
end $$;

-- Grant by OID so signature spelling (char vs character) cannot break the script.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_transaction'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;

-- Net Room Service amount posted on folio for a bill (charges minus reversals).
create or replace function public.fnb_room_service_folio_net(
  p_folio_id text,
  p_bill_id text
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
    case
      when t.source_type = 'ROOM_SERVICE' then t.amount
      when t.source_type = 'ROOM_SERVICE_REVERSAL' then -t.amount
      else 0
    end
  ), 0)::numeric(14, 2)
  from public.transactions t
  where t.folio_id = p_folio_id
    and t.source_module = 'FNB'::public.transaction_source_module
    and t.source_id = p_bill_id
    and t.status = 'COMPLETED'::public.transaction_status
    and t.transaction_type = 'ADJUSTMENT'::public.transaction_type;
$$;

-- Atomic Room Charge settlement: folio charge + folio/reservation totals + F&B bill + order.
create or replace function public.fnb_settle_room_charge(
  p_bill_id text,
  p_order_id text,
  p_booking_id text,
  p_guest_id text default null,
  p_amount numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_bill public.fb_bills%rowtype;
  v_order public.fb_orders%rowtype;
  v_folio_id text;
  v_amount numeric(14, 2);
  v_notes text;
  v_txn public.transactions%rowtype;
  v_existing int;
begin
  if p_bill_id is null or trim(p_bill_id) = '' then
    raise exception 'bill_id is required' using errcode = 'P0001';
  end if;
  if p_order_id is null or trim(p_order_id) = '' then
    raise exception 'order_id is required' using errcode = 'P0001';
  end if;
  if p_booking_id is null or trim(p_booking_id) = '' then
    raise exception 'booking_id is required' using errcode = 'P0001';
  end if;

  select * into v_bill from public.fb_bills where id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;

  select * into v_order from public.fb_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if coalesce(v_order.type, '') <> 'Room Service' then
    raise exception 'Room Charge is only for Room Service orders' using errcode = 'P0001';
  end if;

  if v_bill.order_id is distinct from p_order_id then
    raise exception 'Bill does not belong to order' using errcode = 'P0001';
  end if;

  if upper(coalesce(v_bill.payment_status, 'UNPAID')) = 'PAID' then
    raise exception 'Bill is already paid' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount, v_bill.total, 0)::numeric(14, 2);
  if v_amount <= 0 then
    raise exception 'Settlement amount must be > 0' using errcode = 'P0001';
  end if;

  v_folio_id := public.ensure_folio_for_booking(p_booking_id, p_guest_id);

  select count(*) into v_existing
  from public.transactions t
  where t.folio_id = v_folio_id
    and t.source_module = 'FNB'::public.transaction_source_module
    and t.source_type = 'ROOM_SERVICE'
    and t.source_id = p_bill_id
    and t.status = 'COMPLETED'::public.transaction_status;

  if v_existing > 0 then
    raise exception 'Room Service charge already posted for this bill' using errcode = 'P0001';
  end if;

  v_notes := coalesce(
    nullif(trim(p_notes), ''),
    format('[ROOM_SERVICE] charge — order %s', p_order_id)
  );

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
    source_type,
    source_id,
    notes
  ) values (
    'ADJUSTMENT'::public.transaction_type,
    'OTHER'::public.payment_method,
    v_amount,
    'INR',
    'COMPLETED'::public.transaction_status,
    v_folio_id,
    p_booking_id,
    nullif(trim(p_guest_id), ''),
    'FNB'::public.transaction_source_module,
    'ROOM_SERVICE',
    p_bill_id,
    v_notes
  )
  returning * into v_txn;

  update public.folios
  set subtotal = greatest(0, coalesce(subtotal, 0) + v_amount)
  where id = v_folio_id;

  update public.reservations
  set restaurant_bill = greatest(0, coalesce(restaurant_bill, 0) + v_amount)
  where id = p_booking_id;

  update public.fb_bills
  set
    payment_status = 'PAID',
    status = 'CLOSED',
    updated_at = now()
  where id = p_bill_id;

  update public.fb_orders
  set
    payment_mode = 'Room Charge',
    status = 'Settled',
    lifecycle_status = 'CLOSED',
    paid_at = to_char(now() at time zone 'Asia/Kolkata', 'FMHH12:MI AM')
  where id = p_order_id;

  return jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'folioId', v_folio_id,
    'billId', p_bill_id,
    'orderId', p_order_id,
    'amount', v_amount
  );
end;
$$;

-- Atomic post-cancellation sync: bill totals + folio reversal (Room Charge only).
create or replace function public.fnb_sync_room_service_after_cancellation(
  p_bill_id text,
  p_order_id text,
  p_new_subtotal numeric,
  p_new_tax numeric default 0,
  p_new_discount numeric default 0,
  p_new_total numeric default null,
  p_reversal_notes text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_bill public.fb_bills%rowtype;
  v_order public.fb_orders%rowtype;
  v_folio_id text;
  v_booking_id text;
  v_target numeric(14, 2);
  v_current_net numeric(14, 2);
  v_delta numeric(14, 2);
  v_reversal numeric(14, 2);
  v_notes text;
  v_txn public.transactions%rowtype;
begin
  select * into v_bill from public.fb_bills where id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;

  select * into v_order from public.fb_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if coalesce(v_order.type, '') <> 'Room Service' then
    return jsonb_build_object('skipped', true, 'reason', 'not_room_service');
  end if;

  if upper(coalesce(v_bill.payment_status, '')) <> 'PAID'
     or coalesce(v_order.payment_mode, '') not ilike '%room charge%' then
    return jsonb_build_object('skipped', true, 'reason', 'not_room_charge_settled');
  end if;

  v_booking_id := nullif(trim(v_order.reservation_id), '');
  if v_booking_id is null then
    raise exception 'Room Service order has no reservation' using errcode = 'P0001';
  end if;

  v_target := coalesce(
    p_new_total,
    greatest(0, coalesce(p_new_subtotal, 0) + coalesce(p_new_tax, 0) - coalesce(p_new_discount, 0))
  )::numeric(14, 2);

  update public.fb_bills
  set
    subtotal = greatest(0, coalesce(p_new_subtotal, 0)),
    tax = greatest(0, coalesce(p_new_tax, 0)),
    discount = greatest(0, coalesce(p_new_discount, 0)),
    total = v_target,
    updated_at = now()
  where id = p_bill_id;

  v_folio_id := public.ensure_folio_for_booking(v_booking_id, v_order.guest_id);
  v_current_net := public.fnb_room_service_folio_net(v_folio_id, p_bill_id);
  v_delta := round((v_target - v_current_net)::numeric, 2);

  if abs(v_delta) < 0.01 then
    return jsonb_build_object(
      'billId', p_bill_id,
      'folioId', v_folio_id,
      'targetNet', v_target,
      'currentNet', v_current_net,
      'delta', 0
    );
  end if;

  if v_delta > 0 then
    raise exception 'Cannot increase Room Service folio charge after settlement; create a new order'
      using errcode = 'P0001';
  end if;

  v_reversal := abs(v_delta);
  v_notes := coalesce(
    nullif(trim(p_reversal_notes), ''),
    format('[ROOM_SERVICE] reversal — order %s, cancelled amount %s', p_order_id, v_reversal)
  );

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
    source_type,
    source_id,
    notes
  ) values (
    'ADJUSTMENT'::public.transaction_type,
    'OTHER'::public.payment_method,
    v_reversal,
    'INR',
    'COMPLETED'::public.transaction_status,
    v_folio_id,
    v_booking_id,
    v_order.guest_id,
    'FNB'::public.transaction_source_module,
    'ROOM_SERVICE_REVERSAL',
    p_bill_id,
    v_notes
  )
  returning * into v_txn;

  update public.folios
  set subtotal = greatest(0, coalesce(subtotal, 0) + v_delta)
  where id = v_folio_id;

  update public.reservations
  set restaurant_bill = greatest(0, coalesce(restaurant_bill, 0) + v_delta)
  where id = v_booking_id;

  return jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'billId', p_bill_id,
    'folioId', v_folio_id,
    'targetNet', v_target,
    'previousNet', v_current_net,
    'delta', v_delta
  );
end;
$$;

grant execute on function public.fnb_room_service_folio_net(text, text) to anon, authenticated;
grant execute on function public.fnb_settle_room_charge(text, text, text, text, numeric, text) to anon, authenticated;
grant execute on function public.fnb_sync_room_service_after_cancellation(text, text, numeric, numeric, numeric, numeric, text) to anon, authenticated;

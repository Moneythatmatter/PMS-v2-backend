-- Backfill POS v2 from legacy fb_orders.lines JSON and fb_live_tables runtime fields.
-- Safe to re-run (skips orders that already have order_items).

-- 1) Backfill order_items from fb_orders.lines
insert into fb_order_items (id, order_id, menu_item_id, name, quantity, unit_price, line_total, note, status)
select
  'OI' || substr(md5(o.id || '-' || (elem.ordinality)::text), 1, 12),
  o.id,
  null,
  coalesce(elem.value->>'name', 'Item'),
  greatest(coalesce((elem.value->>'qty')::numeric, 1), 1),
  case
    when coalesce((elem.value->>'qty')::numeric, 0) > 0
    then round(coalesce(o.amount, 0) / nullif(
      (select sum(greatest(coalesce((e.value->>'qty')::numeric, 1), 1))
       from jsonb_array_elements(o.lines) with ordinality e(value, ordinality)), 0), 2)
    else 0
  end,
  case
    when coalesce((elem.value->>'qty')::numeric, 0) > 0
    then round(coalesce(o.amount, 0) / nullif(
      (select sum(greatest(coalesce((e.value->>'qty')::numeric, 1), 1))
       from jsonb_array_elements(o.lines) with ordinality e(value, ordinality)), 0)
         * greatest(coalesce((elem.value->>'qty')::numeric, 1), 1), 2)
    else 0
  end,
  elem.value->>'note',
  case when lower(coalesce(o.status, '')) in ('rejected', 'cancelled') then 'VOID' else 'ACTIVE' end
from fb_orders o
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(o.lines) = 'array' and jsonb_array_length(o.lines) > 0 then o.lines else '[]'::jsonb end
) with ordinality as elem(value, ordinality)
where not exists (select 1 from fb_order_items oi where oi.order_id = o.id);

-- 2) Set lifecycle_status from legacy order status
update fb_orders set lifecycle_status = 'CLOSED'
where lower(coalesce(status, '')) in ('settled', 'closed', 'paid')
  and lifecycle_status = 'OPEN';

update fb_orders set lifecycle_status = 'CANCELLED'
where lower(coalesce(status, '')) in ('rejected', 'cancelled')
  and lifecycle_status = 'OPEN';

-- 3) Create bills for settled orders without a bill
insert into fb_bills (id, order_id, bill_no, status, payment_status, bill_printed_at, subtotal, tax, discount, total)
select
  'BL' || substr(md5(o.id), 1, 12),
  o.id,
  'BILL-' || coalesce(o.order_no, o.id),
  'CLOSED',
  'PAID',
  coalesce(o.created_at, now()),
  coalesce(o.amount, 0),
  0,
  0,
  coalesce(o.amount, 0)
from fb_orders o
where lower(coalesce(o.status, '')) in ('settled', 'closed', 'paid')
  and not exists (select 1 from fb_bills b where b.order_id = o.id);

-- 4) Mark dirty tables from legacy Dirty status
update fb_live_tables set housekeeping = 'DIRTY'
where lower(coalesce(status, '')) = 'dirty'
  and housekeeping = 'CLEAN';

-- 5) Open sessions for occupied dine-in tables (best-effort from latest open order)
insert into fb_table_sessions (id, live_table_id, outlet_id, guest_name, pax, server, status, opened_at)
select
  'TS' || substr(md5(lt.id || '-' || o.id), 1, 12),
  lt.id,
  lt.outlet_id,
  coalesce(nullif(o.guest, ''), nullif(lt.guest, ''), 'Walk-in'),
  greatest(coalesce(o.pax, lt.covers, 2), 1),
  coalesce(nullif(o.server, ''), nullif(lt.server, ''), ''),
  'OPEN',
  coalesce(o.created_at, now())
from fb_live_tables lt
join lateral (
  select *
  from fb_orders ord
  where ord.outlet_id = lt.outlet_id
    and lower(trim(ord.ref)) = lower(trim(lt.table_no))
    and ord.type = 'Dine In'
    and ord.lifecycle_status = 'OPEN'
  order by ord.created_at desc nulls last
  limit 1
) o on true
where lower(coalesce(lt.status, '')) in ('occupied', 'reserved', 'billing')
  and not exists (
    select 1 from fb_table_sessions s
    where s.live_table_id = lt.id and s.status = 'OPEN'
  );

-- 6) Link orders to sessions
update fb_orders o
set session_id = s.id
from fb_table_sessions s
join fb_live_tables lt on lt.id = s.live_table_id
where o.session_id is null
  and o.type = 'Dine In'
  and o.lifecycle_status = 'OPEN'
  and lower(trim(o.ref)) = lower(trim(lt.table_no))
  and o.outlet_id = lt.outlet_id
  and s.live_table_id = lt.id
  and s.status = 'OPEN';

-- 7) Create KOT tickets for open orders that have items but no KOT
insert into fb_kot_tickets (id, order_id, kot_number, status, created_at, updated_at)
select
  'KT' || substr(md5(o.id), 1, 12),
  o.id,
  'KOT-' || coalesce(o.order_no, o.id),
  case lower(coalesce(o.status, ''))
    when 'preparing' then 'PREPARING'
    when 'ready' then 'READY'
    when 'served' then 'SERVED'
    else 'PENDING'
  end,
  coalesce(o.created_at, now()),
  now()
from fb_orders o
where o.lifecycle_status = 'OPEN'
  and exists (select 1 from fb_order_items oi where oi.order_id = o.id)
  and not exists (select 1 from fb_kot_tickets k where k.order_id = o.id);

-- 8) Link kot_items to order_items (one KOT per order from backfill)
insert into fb_kot_items (id, kot_id, order_item_id, quantity, status)
select
  'KI' || substr(md5(k.id || '-' || oi.id), 1, 12),
  k.id,
  oi.id,
  oi.quantity,
  case k.status
    when 'PREPARING' then 'PREPARING'
    when 'READY' then 'READY'
    when 'SERVED' then 'SERVED'
    else 'PENDING'
  end
from fb_kot_tickets k
join fb_order_items oi on oi.order_id = k.order_id and oi.status = 'ACTIVE'
where not exists (select 1 from fb_kot_items ki where ki.kot_id = k.id);

-- 9) Unpaid bills for open served orders
insert into fb_bills (id, order_id, bill_no, status, payment_status, subtotal, total)
select
  'BL' || substr(md5(o.id || '-open'), 1, 12),
  o.id,
  'BILL-' || coalesce(o.order_no, o.id),
  'OPEN',
  'UNPAID',
  coalesce(o.amount, 0),
  coalesce(o.amount, 0)
from fb_orders o
where o.lifecycle_status = 'OPEN'
  and lower(coalesce(o.status, '')) in ('served', 'ready', 'preparing', 'pending')
  and not exists (select 1 from fb_bills b where b.order_id = o.id);

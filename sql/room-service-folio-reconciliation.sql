-- Read-only reconciliation: Room Service folio rows that may need manual review.
-- Do NOT auto-fix from application code.

select
  b.id as fb_bill_id,
  b.bill_no,
  b.payment_status as fb_payment_status,
  o.payment_mode as fb_order_payment_mode,
  b.total as fb_bill_total,
  o.id as fb_order_id,
  o.order_no,
  o.type as order_type,
  o.reservation_id as booking_id,
  f.id as folio_id,
  f.folio_number,
  t.id as transaction_id,
  t.transaction_number,
  t.transaction_type,
  t.source_module,
  t.source_type,
  t.source_id,
  t.amount,
  t.notes,
  t.transaction_date
from public.transactions t
left join public.fb_bills b on b.id = t.source_id
left join public.fb_orders o on o.id = b.order_id
left join public.folios f on f.id = t.folio_id
where t.folio_id is not null
  and t.transaction_type = 'ADJUSTMENT'::public.transaction_type
  and t.source_module = 'FNB'::public.transaction_source_module
  and (
    t.source_type in ('ROOM_SERVICE', 'ROOM_SERVICE_REVERSAL')
    or (t.source_type is null and t.notes ilike '%room service%')
  )
order by t.transaction_date desc;

-- Suspected early/wrong posts: folio charge but bill not settled via Room Charge
select
  b.id as fb_bill_id,
  b.payment_status,
  o.payment_mode,
  b.total,
  o.id as order_id,
  o.reservation_id,
  t.id as folio_txn_id,
  t.source_type,
  t.amount,
  t.notes
from public.transactions t
join public.fb_bills b on b.id = t.source_id
join public.fb_orders o on o.id = b.order_id
where t.folio_id is not null
  and t.transaction_type = 'ADJUSTMENT'::public.transaction_type
  and o.type = 'Room Service'
  and (
    upper(coalesce(b.payment_status, '')) <> 'PAID'
    or coalesce(o.payment_mode, '') not ilike '%room charge%'
  )
  and (
    t.source_type = 'ROOM_SERVICE'
    or (t.source_type is null and t.notes ilike '%room service%')
  );

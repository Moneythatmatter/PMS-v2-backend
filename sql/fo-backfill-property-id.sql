-- Backfill property_id on front-office rows created without it, so each property only sees its own data.
-- Shaw Hotel = 'prop-shaw-hotel'. Rows linked to a folio / booking inherit that property first,
-- so Grand Palace payments are not moved into Shaw Hotel. Run once in Supabase SQL Editor.

begin;

-- 1) Transactions: inherit from the folio they were posted to
update public.transactions t
set property_id = f.property_id
from public.folios f
where t.property_id is null
  and t.folio_id = f.id
  and f.property_id is not null;

-- 2) Transactions: otherwise inherit from the booking
update public.transactions t
set property_id = r.property_id
from public.reservations r
where t.property_id is null
  and t.booking_id = r.id
  and r.property_id is not null;

-- 3) Anything still unlinked belongs to Shaw Hotel
update public.transactions
set property_id = 'prop-shaw-hotel'
where property_id is null;

-- 4) Reservations and guests missing a property
update public.reservations
set property_id = 'prop-shaw-hotel'
where property_id is null;

update public.guests
set property_id = 'prop-shaw-hotel'
where property_id is null;

-- 5) Folios / folio charges (currently all set — kept as a safety net)
update public.folios f
set property_id = r.property_id
from public.reservations r
where f.property_id is null
  and f.booking_id = r.id;

update public.folios
set property_id = 'prop-shaw-hotel'
where property_id is null;

update public.folio_charges
set property_id = 'prop-shaw-hotel'
where property_id is null;

commit;

-- Check: every count should be 0
select 'transactions' as table_name, count(*) filter (where property_id is null) as missing from public.transactions
union all select 'reservations', count(*) filter (where property_id is null) from public.reservations
union all select 'guests', count(*) filter (where property_id is null) from public.guests
union all select 'folios', count(*) filter (where property_id is null) from public.folios
union all select 'folio_charges', count(*) filter (where property_id is null) from public.folio_charges;

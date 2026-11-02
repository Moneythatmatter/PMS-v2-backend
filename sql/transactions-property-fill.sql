-- Folio ledger rows posted by RPCs (fnb_settle_room_charge, room-service reversals,
-- hk_settle_laundry_folio_charge, record_transaction) were saved with property_id = NULL.
-- The API lists transactions per property, so these charges were hidden from the guest folio
-- and the folio showed the food / laundry amount as part of "Room charges".
--
-- This adds a trigger that fills transactions.property_id from the folio (or booking) when it
-- is missing, and backfills existing rows. Safe to re-run. Run once in Supabase SQL Editor.

create or replace function public.transactions_fill_property()
returns trigger
language plpgsql
as $$
begin
  if new.property_id is null and new.folio_id is not null then
    select f.property_id into new.property_id from public.folios f where f.id = new.folio_id;
  end if;
  if new.property_id is null and new.booking_id is not null then
    select r.property_id into new.property_id from public.reservations r where r.id::text = new.booking_id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_fill_property on public.transactions;
create trigger trg_transactions_fill_property
  before insert or update of folio_id, booking_id, property_id on public.transactions
  for each row execute function public.transactions_fill_property();

-- Backfill (keep updated_at unchanged)
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_transactions_set_updated_at') then
    execute 'alter table public.transactions disable trigger trg_transactions_set_updated_at';
  end if;

  update public.transactions t
  set property_id = f.property_id
  from public.folios f
  where t.property_id is null and t.folio_id = f.id and f.property_id is not null;

  update public.transactions t
  set property_id = r.property_id
  from public.reservations r
  where t.property_id is null and t.booking_id is not null
    and r.id::text = t.booking_id::text and r.property_id is not null;

  if exists (select 1 from pg_trigger where tgname = 'trg_transactions_set_updated_at') then
    execute 'alter table public.transactions enable trigger trg_transactions_set_updated_at';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check: should be 0 (or only rows with neither folio nor booking)
select count(*) as transactions_without_property from public.transactions where property_id is null;

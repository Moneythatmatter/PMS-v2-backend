-- Fix folio paid_amount double-counting (reservation advance seeded + transaction ledger).
-- Paid balance should match sum of COMPLETED PAYMENT / REFUND transactions on the folio.

create or replace function public.recalculate_folio_paid(p_folio_id text)
returns void
language plpgsql
security definer
as $$
declare
  v_paid numeric(14, 2);
begin
  if p_folio_id is null or trim(p_folio_id) = '' then
    return;
  end if;

  select coalesce(sum(
    case
      when transaction_type = 'PAYMENT'::public.transaction_type then coalesce(amount, 0)
      when transaction_type = 'REFUND'::public.transaction_type then -coalesce(amount, 0)
      else 0
    end
  ), 0)
  into v_paid
  from public.transactions
  where folio_id = p_folio_id
    and status = 'COMPLETED'::public.transaction_status;

  update public.folios
  set paid_amount = greatest(0, v_paid)
  where id = p_folio_id;
end;
$$;

-- Stop seeding paid_amount from reservation advance (ledger owns paid totals).
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
  v_folio_subtotal numeric(14, 2);
begin
  select coalesce(r.total_amount, 0)
  into v_subtotal
  from public.reservations r
  where r.id = p_booking_id;

  if not found then
    return;
  end if;

  select coalesce(f.subtotal, 0)
  into v_folio_subtotal
  from public.folios f
  where f.id = p_folio_id;

  if not found then
    return;
  end if;

  if v_folio_subtotal = 0 and v_subtotal > 0 then
    update public.folios
    set subtotal = v_subtotal
    where id = p_folio_id;
  end if;
end;
$$;

-- Backfill all folios from transaction ledger
do $$
declare
  r record;
begin
  for r in select id from public.folios loop
    perform public.recalculate_folio_paid(r.id);
  end loop;
end;
$$;

grant execute on function public.recalculate_folio_paid(text) to anon, authenticated;

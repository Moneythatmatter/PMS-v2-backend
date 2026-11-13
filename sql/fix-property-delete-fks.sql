-- Fix property delete blocked by reservation_guests → guests RESTRICT FK
-- and harden delete_property_cascade ordering.
-- Run in Supabase SQL Editor.

-- ========== 1) reservation_guests.guest_id → CASCADE ==========
alter table public.reservation_guests
  drop constraint if exists reservation_guests_guest_id_fkey;

alter table public.reservation_guests
  add constraint reservation_guests_guest_id_fkey
  foreign key (guest_id) references public.guests(id) on delete cascade;

-- reservation_id should cascade too when a reservation is removed
alter table public.reservation_guests
  drop constraint if exists reservation_guests_reservation_id_fkey;

do $$
begin
  if to_regclass('public.reservations') is not null then
    alter table public.reservation_guests
      add constraint reservation_guests_reservation_id_fkey
      foreign key (reservation_id) references public.reservations(id) on delete cascade;
  end if;
exception when others then
  raise notice 'reservation_id FK: %', sqlerrm;
end $$;

-- ========== 2) Stronger wipe function (children before parents) ==========
create or replace function public.delete_property_cascade(p_property_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  r record;
  n bigint;
  pass int;
  report jsonb := '{}'::jsonb;
  -- Delete junction / child tables before masters they reference
  priority text[] := array[
    'reservation_guests',
    'guest_documents',
    'folio_charges',
    'folio_entries',
    'fo_group_billing_rules',
    'acc_voucher_lines',
    'acc_covering_letter_bills',
    'acc_bill_settlements',
    'fb_kot_items',
    'fb_order_items',
    'fb_conversion_lines',
    'fb_conversion_item_lines',
    'fb_recipe_ingredients',
    'fb_recipe_consumptions',
    'purchase_requisition_items',
    'ps_stock_ledger',
    'hr_employee_documents',
    'hr_leave_balance_transactions',
    -- then mid-level
    'folios',
    'payments',
    'reservations',
    'guest_stay_history',
    'fb_kot_tickets',
    'fb_bills',
    'fb_orders',
    'fb_conversions',
    'guests',
    'rooms',
    'hk_rooms'
  ];
  t text;
begin
  if p_property_id is null or btrim(p_property_id) = '' then
    raise exception 'property id is required';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property % not found', p_property_id;
  end if;

  -- Pass A: priority order
  foreach t in array priority loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_id'
    ) then
      continue;
    end if;
    begin
      execute format('delete from public.%I where property_id = $1', t)
        using p_property_id;
      get diagnostics n = row_count;
      if n > 0 then
        report := report || jsonb_build_object(t, n);
      end if;
    exception when others then
      report := report || jsonb_build_object(t || '_error', sqlerrm);
    end;
  end loop;

  -- Pass B: also clear reservation_guests linked via guests/reservations of this property
  -- (covers rows missing property_id)
  begin
    delete from public.reservation_guests rg
    where rg.property_id = p_property_id
       or rg.guest_id in (select g.id from public.guests g where g.property_id = p_property_id)
       or rg.reservation_id in (select r.id from public.reservations r where r.property_id = p_property_id);
    get diagnostics n = row_count;
    if n > 0 then
      report := report || jsonb_build_object('reservation_guests_extra', n);
    end if;
  exception when others then
    report := report || jsonb_build_object('reservation_guests_extra_error', sqlerrm);
  end;

  -- Pass C: remaining property_id tables (multiple rounds for FK order)
  for pass in 1..10 loop
    for r in
      select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = 'public'
       and t.table_name = c.table_name
       and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public'
        and c.column_name = 'property_id'
        and c.table_name <> 'properties'
      order by c.table_name
    loop
      begin
        execute format('delete from public.%I where property_id = $1', r.table_name)
          using p_property_id;
        get diagnostics n = row_count;
        if n > 0 then
          report := report || jsonb_build_object(
            r.table_name,
            coalesce((report ->> r.table_name)::bigint, 0) + n
          );
        end if;
      exception when others then
        if pass = 10 then
          report := report || jsonb_build_object(r.table_name || '_final_error', sqlerrm);
        end if;
      end;
    end loop;
  end loop;

  delete from public.user_permissions where property_id = p_property_id;
  delete from public.user_property_access where property_id = p_property_id;

  delete from public.properties where id = p_property_id;

  report := report || jsonb_build_object('_property', p_property_id, '_deleted', true);
  return report;
end;
$$;

grant execute on function public.delete_property_cascade(text) to anon, authenticated, service_role;

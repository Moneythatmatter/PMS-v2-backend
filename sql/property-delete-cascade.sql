-- Wipe all property-scoped data when a property is deleted.
-- Run in Supabase SQL Editor.
--
-- 1) Ensures property_id FKs use ON DELETE CASCADE where possible
-- 2) Fixes reservation_guests → guests (was RESTRICT, blocked deletes)
-- 3) Provides delete_property_cascade(property_id) with safe delete order

-- ========== Ensure ON DELETE CASCADE for property_id FKs ==========
do $$
declare
  r record;
  con_name text;
begin
  for r in
    select
      c.conrelid::regclass as tbl,
      c.conname,
      a.attname as col
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.properties'::regclass
      and a.attname = 'property_id'
  loop
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
    con_name := r.conname;
    begin
      execute format(
        'alter table %s add constraint %I foreign key (property_id) references public.properties(id) on delete cascade',
        r.tbl,
        con_name
      );
    exception when others then
      raise notice 'Could not recreate FK %.%: %', r.tbl, con_name, sqlerrm;
    end;
  end loop;

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
      and not exists (
        select 1
        from pg_constraint pc
        join pg_attribute pa
          on pa.attrelid = pc.conrelid
         and pa.attnum = any (pc.conkey)
        where pc.contype = 'f'
          and pc.conrelid = format('public.%I', c.table_name)::regclass
          and pc.confrelid = 'public.properties'::regclass
          and pa.attname = 'property_id'
      )
  loop
    begin
      execute format(
        'alter table public.%I
           add constraint %I
           foreign key (property_id) references public.properties(id) on delete cascade',
        r.table_name,
        r.table_name || '_property_id_fkey'
      );
    exception when others then
      raise notice 'Skip FK on %: %', r.table_name, sqlerrm;
    end;
  end loop;
end $$;

-- ========== Fix reservation_guests → guests (RESTRICT blocked property wipe) ==========
alter table public.reservation_guests
  drop constraint if exists reservation_guests_guest_id_fkey;

alter table public.reservation_guests
  add constraint reservation_guests_guest_id_fkey
  foreign key (guest_id) references public.guests(id) on delete cascade;

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

-- ========== Fix maintenance_requests.room_id SET NULL vs location check ==========
alter table public.maintenance_requests
  drop constraint if exists maintenance_requests_room_id_fkey;

alter table public.maintenance_requests
  add constraint maintenance_requests_room_id_fkey
  foreign key (room_id) references public.rooms(id) on delete cascade;

-- ========== Hard wipe helper ==========
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
  priority text[] := array[
    'reservation_guests',
    'guest_documents',
    'folio_charges',
    'folio_entries',
    'fo_group_billing_rules',
    'maintenance_requests',
    'housekeeping_requests',
    'housekeeping_tasks',
    'guest_requests',
    'damage_reports',
    'lost_found_items',
    'room_availability_blocks',
    'room_transfers',
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
    'folios',
    'payments',
    'reservations',
    'guest_stay_history',
    'fb_kot_tickets',
    'fb_bills',
    'fb_orders',
    'fb_conversions',
    'guests',
    'hk_rooms',
    'mnt_rooms',
    'rooms'
  ];
  t text;
begin
  if p_property_id is null or btrim(p_property_id) = '' then
    raise exception 'property id is required';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property % not found', p_property_id;
  end if;

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

  -- Clear reservation_guests linked via guests/reservations (missing property_id rows)
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

  begin
    delete from public.maintenance_requests mr
    where mr.property_id = p_property_id
       or mr.room_id in (select rm.id from public.rooms rm where rm.property_id = p_property_id);
    get diagnostics n = row_count;
    if n > 0 then
      report := report || jsonb_build_object('maintenance_requests_extra', n);
    end if;
  exception when others then
    report := report || jsonb_build_object('maintenance_requests_extra_error', sqlerrm);
  end;

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

comment on function public.delete_property_cascade(text) is
  'Deletes a property and all rows in every public table that has property_id for that property.';

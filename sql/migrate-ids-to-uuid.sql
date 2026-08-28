-- Migrate all text primary-key `id` values (and known FK refs) to UUID v4.
-- Run once in Supabase SQL Editor. Safe to re-run: skips rows that already look like UUIDs.
-- Does NOT change business keys (room_no, order_no, table_no, txn numbers, etc.).

create extension if not exists pgcrypto;

create or replace function public.is_uuid_text(v text)
returns boolean
language sql
immutable
as $$
  select v is not null
    and v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create or replace function public.table_exists(p_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = p_name
  );
$$;

create or replace function public.column_exists(p_table text, p_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_column
  );
$$;

-- Remap non-UUID primary keys on a single table (no dependent FKs required).
create or replace function public.remap_pk_ids(p_table text)
returns integer
language plpgsql
as $$
declare
  r record;
  updated int := 0;
  nid text;
begin
  if not public.table_exists(p_table) then
    return 0;
  end if;
  if not public.column_exists(p_table, 'id') then
    return 0;
  end if;

  for r in execute format(
    'select id from %I where id is not null and not public.is_uuid_text(id)',
    p_table
  ) loop
    nid := gen_random_uuid()::text;
    execute format('update %I set id = $1 where id = $2', p_table)
      using nid, r.id;
    updated := updated + 1;
  end loop;
  return updated;
end;
$$;

-- Remap parent PK and rewrite child FK columns that still point at old ids.
create or replace function public.remap_parent_and_fks(
  p_parent text,
  p_children text[][]
)
returns void
language plpgsql
as $$
declare
  r record;
  child text[];
begin
  if not public.table_exists(p_parent) then
    return;
  end if;

  create temporary table if not exists _id_map (
    old_id text primary key,
    new_id text not null
  ) on commit drop;
  truncate _id_map;

  for r in execute format(
    'select id from %I where id is not null and not public.is_uuid_text(id)',
    p_parent
  ) loop
    insert into _id_map(old_id, new_id) values (r.id, gen_random_uuid()::text);
  end loop;

  if not exists (select 1 from _id_map) then
    return;
  end if;

  foreach child slice 1 in array p_children loop
    if public.table_exists(child[1]) and public.column_exists(child[1], child[2]) then
      execute format(
        'update %I t set %I = m.new_id from _id_map m where t.%I::text = m.old_id',
        child[1], child[2], child[2]
      );
    end if;
  end loop;

  execute format(
    'update %I p set id = m.new_id from _id_map m where p.id = m.old_id',
    p_parent
  );
end;
$$;

begin;

-- ========== AUTH ==========
select public.remap_pk_ids('users');

-- ========== FRONT OFFICE parents ==========
select public.remap_parent_and_fks(
  'guests',
  array[
    array['reservations', 'guest_id'],
    array['guest_stay_history', 'guest_id'],
    array['desk_activity', 'guest_id']
  ]
);

select public.remap_parent_and_fks(
  'reservations',
  array[
    array['folio_entries', 'reservation_id'],
    array['payments', 'reservation_id'],
    array['desk_activity', 'reservation_id'],
    array['invoices', 'booking_id']
  ]
);

-- FO standalone id tables (rooms use room_no as unique business key; reservations use UUID id)
select public.remap_pk_ids('room_types');
select public.remap_pk_ids('tariff_plans');
select public.remap_pk_ids('market_segments');
select public.remap_pk_ids('companies');
select public.remap_pk_ids('booking_sources');
select public.remap_pk_ids('guest_stay_history');
select public.remap_pk_ids('folio_entries');
select public.remap_pk_ids('payments');
select public.remap_pk_ids('invoices');
select public.remap_pk_ids('room_transfers');
select public.remap_pk_ids('wake_up_calls');
select public.remap_pk_ids('taxi_bookings');
select public.remap_pk_ids('luggage_items');
select public.remap_pk_ids('messages');
select public.remap_pk_ids('guest_feedback');
select public.remap_pk_ids('lost_found_items');
select public.remap_pk_ids('housekeeping_requests');
select public.remap_pk_ids('maintenance_requests');
select public.remap_pk_ids('cashier_shifts');
select public.remap_pk_ids('room_charge_postings');
select public.remap_pk_ids('day_closings');
select public.remap_pk_ids('desk_activity');

-- ========== FOOD & BEVERAGES ==========
select public.remap_parent_and_fks(
  'fb_outlets',
  array[
    array['fb_live_tables', 'outlet_id'],
    array['fb_orders', 'outlet_id'],
    array['fb_kds_tickets', 'outlet_id'],
    array['fb_cashier_shifts', 'outlet_id'],
    array['fb_reservations', 'outlet_id'],
    array['fb_pricing_rules', 'outlet_id'],
    array['fb_banquet_bookings', 'outlet_id'],
    array['fb_banquet_requirements', 'outlet_id'],
    array['fb_drinks', 'outlet_id'],
    array['fb_happy_hour', 'outlet_id'],
    array['fb_bar_stock', 'outlet_id'],
    array['fb_bottle_tracking', 'outlet_id'],
    array['fb_day_closings', 'outlet_id']
  ]
);

select public.remap_parent_and_fks(
  'fb_cashier_shifts',
  array[
    array['fb_orders', 'cashier_shift_id']
  ]
);

select public.remap_pk_ids('fb_live_tables');
select public.remap_pk_ids('fb_orders');
select public.remap_pk_ids('fb_kds_tickets');
select public.remap_pk_ids('fb_reservations');
select public.remap_pk_ids('fnb_menu_categories');
select public.remap_pk_ids('fnb_menu_items');
select public.remap_pk_ids('fnb_units');
select public.remap_pk_ids('fnb_tax_groups');
select public.remap_pk_ids('fnb_stations');
select public.remap_pk_ids('fb_modifiers');
select public.remap_pk_ids('fb_combos');
select public.remap_pk_ids('fb_pricing_rules');
select public.remap_pk_ids('fb_banquet_bookings');
select public.remap_pk_ids('fb_banquet_packages');
select public.remap_pk_ids('fb_banquet_requirements');
select public.remap_pk_ids('fb_banquet_billing');
select public.remap_pk_ids('fb_ingredients');
select public.remap_pk_ids('fb_units');
select public.remap_pk_ids('fb_tax_groups');
select public.remap_pk_ids('fb_modifier_groups');
select public.remap_pk_ids('fb_stations');
select public.remap_pk_ids('fb_outlet_types');
select public.remap_pk_ids('fb_wastage');
select public.remap_pk_ids('fb_stock_adjustments');
select public.remap_pk_ids('fb_drink_categories');
select public.remap_pk_ids('fb_drinks');
select public.remap_pk_ids('fb_cocktails');
select public.remap_pk_ids('fb_happy_hour');
select public.remap_pk_ids('fb_bar_stock');
select public.remap_pk_ids('fb_bottle_tracking');
select public.remap_pk_ids('fb_taxes');
select public.remap_pk_ids('fb_discounts');
select public.remap_pk_ids('fb_payment_modes');
select public.remap_pk_ids('fb_order_types');
select public.remap_pk_ids('fb_day_closings');

-- ========== HOUSEKEEPING ==========
select public.remap_pk_ids('hk_rooms');
select public.remap_pk_ids('hk_public_areas');
select public.remap_pk_ids('hk_checklist_templates');
select public.remap_pk_ids('hk_staff');
select public.remap_pk_ids('hk_shifts');
select public.remap_pk_ids('hk_inventory');
select public.remap_pk_ids('hk_laundry_jobs');
select public.remap_pk_ids('hk_damage_reports');
select public.remap_pk_ids('hk_requisitions');
select public.remap_pk_ids('hk_history');
select public.remap_pk_ids('hk_luggage_jobs');
select public.remap_pk_ids('hk_settings');

commit;

notify pgrst, 'reload schema';

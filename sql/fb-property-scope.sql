-- F&B property isolation: add property_id to every F&B table and assign existing data to Shaw Hotel.
-- Without this, outlets / orders / bills / menu items of one property show up in every property.
--
-- IMPORTANT: run this BEFORE deploying / restarting the backend that scopes F&B by property,
-- otherwise F&B pages will fail with "column property_id does not exist".
-- Run once in Supabase SQL Editor.

begin;

do $$
declare
  t text;
  tables text[] := array[
    'fb_outlets',
    'fb_outlet_types',
    'fb_live_tables',
    'fb_table_sessions',
    'fb_orders',
    'fb_order_items',
    'fb_kot_tickets',
    'fb_kot_items',
    'fb_bills',
    'fb_kds_tickets',
    'fb_cashier_shifts',
    'fb_day_closings',
    'fb_reservations',
    'fb_guest_order_requests',
    'fb_modifier_groups',
    'fb_modifiers',
    'fb_menu_item_modifier_groups',
    'fb_ingredients',
    'fb_recipes',
    'fb_recipe_ingredients',
    'fb_recipe_consumptions',
    'fb_wastage',
    'fb_stock_adjustments',
    'fb_module_records',
    'fnb_menu_categories',
    'fnb_menu_items',
    'fnb_tax_groups',
    'fnb_units'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip % (table not found)', t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists property_id text', t);
    execute format('update public.%I set property_id = %L where property_id is null', t, 'prop-shaw-hotel');
    execute format('create index if not exists %I on public.%I (property_id)', t || '_property_id_idx', t);
  end loop;
end $$;

commit;

-- Check: every row should now have a property (missing = 0)
select 'fb_outlets' as table_name, count(*) filter (where property_id is null) as missing, count(*) as total from public.fb_outlets
union all select 'fb_orders', count(*) filter (where property_id is null), count(*) from public.fb_orders
union all select 'fb_bills', count(*) filter (where property_id is null), count(*) from public.fb_bills
union all select 'fnb_menu_items', count(*) filter (where property_id is null), count(*) from public.fnb_menu_items
union all select 'fnb_menu_categories', count(*) filter (where property_id is null), count(*) from public.fnb_menu_categories;

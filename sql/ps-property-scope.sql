-- Purchase & Stores property isolation: add property_id to every P&S table and assign existing data to Shaw Hotel.
-- Without this, suppliers / products / requisitions / POs / stock of one property show up in every property.
--
-- IMPORTANT: run this BEFORE deploying / restarting the backend that scopes P&S by property,
-- otherwise Purchase & Stores pages will fail with "column property_id does not exist".
-- Run once in Supabase SQL Editor.

begin;

do $$
declare
  t text;
  tables text[] := array[
    'ps_units',
    'ps_categories',
    'ps_suppliers',
    'ps_products',
    'ps_warehouses',
    'purchase_requisitions',
    'purchase_requisition_items',
    'ps_rfqs',
    'ps_purchase_orders',
    'ps_direct_store_purchases',
    'ps_rate_contracts',
    'ps_invoices',
    'ps_grns',
    'ps_quality_inspections',
    'ps_vendor_returns',
    'ps_stock_balances',
    'ps_stock_ledger',
    'ps_stock_issues',
    'ps_stock_transfers',
    'ps_stock_adjustments',
    'ps_par_stock',
    'ps_batches'
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

-- Master codes were unique across all properties; make them unique per property instead,
-- so each property can have its own "KG" unit, "VEG" category, etc.
do $$
declare
  pair text[];
  pairs text[][] := array[
    array['ps_units', 'unit_code'],
    array['ps_categories', 'category_code'],
    array['ps_suppliers', 'supplier_code'],
    array['ps_products', 'product_code'],
    array['ps_warehouses', 'code']
  ];
  con record;
begin
  foreach pair slice 1 in array pairs loop
    if to_regclass('public.' || pair[1]) is null then
      continue;
    end if;
    for con in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = ('public.' || pair[1])::regclass
        and c.contype = 'u'
        and array_length(c.conkey, 1) = 1
        and a.attname = pair[2]
    loop
      execute format('alter table public.%I drop constraint %I', pair[1], con.conname);
    end loop;
    execute format(
      'create unique index if not exists %I on public.%I (property_id, %I)',
      pair[1] || '_property_' || pair[2] || '_key', pair[1], pair[2]
    );
  end loop;
end $$;

commit;

-- Check: every row should now have a property (missing = 0)
select 'ps_products' as table_name, count(*) filter (where property_id is null) as missing, count(*) as total from public.ps_products
union all select 'ps_suppliers', count(*) filter (where property_id is null), count(*) from public.ps_suppliers
union all select 'purchase_requisitions', count(*) filter (where property_id is null), count(*) from public.purchase_requisitions
union all select 'ps_purchase_orders', count(*) filter (where property_id is null), count(*) from public.ps_purchase_orders
union all select 'ps_stock_balances', count(*) filter (where property_id is null), count(*) from public.ps_stock_balances;

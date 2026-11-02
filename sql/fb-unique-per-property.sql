-- F&B: make codes / names / numbers unique per property instead of across all properties.
-- Before this, creating e.g. menu category "STAR" in property B failed with
--   duplicate key value violates unique constraint "fnb_menu_categories_code_key"
-- because property A already had it.
--
-- For each F&B table below, every single-property unique constraint / unique index
-- (not the primary key, not partial, not containing property_id or any *_id column)
-- is replaced by a unique index on (property_id, <same columns>).
-- Safe to re-run. Run once in Supabase SQL Editor (after fb-property-scope.sql).

do $$
declare
  t text;
  tables text[] := array[
    'fnb_menu_categories',
    'fnb_menu_items',
    'fnb_units',
    'fnb_tax_groups',
    'fb_outlets',
    'fb_outlet_types',
    'fb_live_tables',
    'fb_modifier_groups',
    'fb_modifiers',
    'fb_ingredients',
    'fb_recipes',
    'fb_recipe_consumptions',
    'fb_orders',
    'fb_bills',
    'fb_kot_tickets',
    'fb_reservations'
  ];
  r record;
  cols text;
  new_name text;
  con_name text;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip % (table not found)', t;
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_id'
    ) then
      raise notice 'skip % (no property_id column - run fb-property-scope.sql first)', t;
      continue;
    end if;

    for r in
      select i.indexrelid, ic.relname as index_name,
             array_agg(a.attname::text order by k.ord) as col_names
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = ('public.' || t)::regclass
        and i.indisunique
        and not i.indisprimary
        and i.indpred is null
        and i.indexprs is null
      group by i.indexrelid, ic.relname
    loop
      if 'property_id' = any(r.col_names)
         or exists (select 1 from unnest(r.col_names) c where c = 'id' or c like '%\_id' escape '\') then
        continue;
      end if;

      select string_agg(quote_ident(c), ', ') into cols from unnest(r.col_names) c;
      new_name := left(t || '_' || array_to_string(r.col_names, '_') || '_per_property', 63);

      begin
        execute format('create unique index if not exists %I on public.%I (property_id, %s)', new_name, t, cols);

        select conname into con_name from pg_constraint where conindid = r.indexrelid and contype = 'u';
        if con_name is not null then
          execute format('alter table public.%I drop constraint %I', t, con_name);
        else
          execute format('drop index if exists public.%I', r.index_name);
        end if;
        raise notice '%: % -> % (property_id, %)', t, r.index_name, new_name, cols;
      exception when others then
        raise notice '%: could not convert % (%). Left as is.', t, r.index_name, sqlerrm;
      end;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check: remaining unique keys on F&B tables (should all include property_id or an *_id column)
select c.relname as table_name, ic.relname as index_name, pg_get_indexdef(i.indexrelid) as definition
from pg_index i
join pg_class c on c.oid = i.indrelid
join pg_class ic on ic.oid = i.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (c.relname like 'fb\_%' escape '\' or c.relname like 'fnb\_%' escape '\')
  and i.indisunique and not i.indisprimary
order by 1, 2;

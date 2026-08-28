-- RLS policies for POS v2 tables (required when backend uses SUPABASE_ANON_KEY).
-- Run in Supabase SQL Editor after fb-pos-v2-schema.sql.
-- Matches the anon_all_* pattern in food-beverages-schema.sql.

do $$
declare
  t text;
begin
  foreach t in array array[
    'fb_table_sessions',
    'fb_order_items',
    'fb_kot_tickets',                                                
    'fb_kot_items',
    'fb_bills'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
    execute format('drop policy if exists "authenticated_all_%s" on %I', t, t);
    execute format(
      'create policy "authenticated_all_%s" on %I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

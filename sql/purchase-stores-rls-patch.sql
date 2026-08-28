-- Purchase & Stores — RLS patch (run if tables exist but seed/API writes fail)
-- Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'ps_units','ps_categories','ps_suppliers','ps_products','ps_warehouses',
    'ps_purchase_requisitions','ps_rfqs','ps_purchase_orders','ps_direct_store_purchases',
    'ps_rate_contracts','ps_invoices','ps_grns','ps_quality_inspections','ps_vendor_returns',
    'ps_stock_balances','ps_stock_ledger','ps_stock_issues','ps_stock_transfers',
    'ps_stock_adjustments','ps_par_stock','ps_batches'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

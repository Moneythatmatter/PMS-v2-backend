-- Sales & Marketing — RLS patch (run after sales-marketing-schema.sql)

do $$
declare
  t text;
begin
  foreach t in array array[
    'sm_venues','sm_lead_sources','sm_activity_types','sm_deal_stages','sm_contact_types',
    'sm_booking_types','sm_contacts','sm_leads','sm_deals','sm_activities','sm_bookings',
    'sm_promotions','sm_campaigns','sm_ota_channels'
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

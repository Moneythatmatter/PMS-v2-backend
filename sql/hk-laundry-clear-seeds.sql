-- Optional: clear previously seeded dummy laundry rows (safe to re-run)
-- Does not delete real jobs created from the app after this cleanup.

delete from public.hk_laundry_jobs
where id in ('LD-01', 'LD-02', 'LD-03', 'LD-04', 'LND-1001', 'LND-1002', 'LND-1003',
             'LND-1004', 'LND-1005', 'LND-1006', 'LND-1007', 'LND-1008', 'LND-1009', 'LND-1010');

-- Optional: clear old master seed ids if you ran an earlier seeded masters patch
delete from public.hk_laundry_pricing
where item_id like 'litem-%';

delete from public.hk_laundry_items
where id like 'litem-%';

notify pgrst, 'schema cache';

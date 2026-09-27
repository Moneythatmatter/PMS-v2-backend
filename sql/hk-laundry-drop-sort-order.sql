-- Drop sort_order from laundry item master (run once if column already exists)

alter table public.hk_laundry_items
  drop column if exists sort_order;

notify pgrst, 'schema cache';

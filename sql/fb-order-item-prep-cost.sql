-- Snapshot recipe prep cost onto order lines at KOT time.
-- Historical orders keep this value even if the recipe cost changes later.
alter table public.fb_order_items
  add column if not exists recipe_id text,
  add column if not exists prep_cost_per_unit numeric(14, 4) not null default 0,
  add column if not exists prep_cost_total numeric(14, 4) not null default 0;

create index if not exists idx_fb_order_items_recipe on public.fb_order_items(recipe_id)
  where recipe_id is not null;

-- F&B Recipes — header + ingredient lines + consumption log
-- Ingredients point at the Purchase & Stores material master (ps_products); F&B keeps no copy of materials.
-- Saving a recipe never moves stock. Stock leaves ps_stock_balances only through fb_recipe_consumptions
-- (POS sale settled, or a manual consumption entry), each posted to ps_stock_ledger.
-- Prerequisites: purchase-stores-schema.sql, fnb-menu-categories-schema.sql, fnb-menu-items-schema.sql
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.fb_recipes (
  id uuid primary key default gen_random_uuid(),
  recipe_code text not null unique,
  name text not null,
  category_id uuid references public.fnb_menu_categories (id) on delete set null,
  -- One recipe per menu item; selling that item consumes this recipe.
  menu_item_id uuid unique references public.fnb_menu_items (id) on delete set null,
  yield_quantity numeric(12,3) not null default 1 check (yield_quantity > 0),
  yield_unit text not null default 'Portions',
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  -- Process loss applied on top of every ingredient (spillage, evaporation, plating loss).
  wastage_percent numeric(5,2) not null default 0 check (wastage_percent between 0 and 100),
  prep_time_minutes integer check (prep_time_minutes is null or prep_time_minutes >= 0),
  issue_warehouse_id text references public.ps_warehouses (id) on delete set null,
  instructions text not null default '',
  notes text not null default '',
  -- Costing snapshot from the last save (live cost is recomputed on read).
  batch_cost numeric(14,2) not null default 0,
  cost_per_portion numeric(14,2) not null default 0,
  food_cost_percent numeric(7,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fb_recipes_category on public.fb_recipes (category_id);
create index if not exists idx_fb_recipes_active on public.fb_recipes (is_active);

create table if not exists public.fb_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.fb_recipes (id) on delete cascade,
  line_no integer not null default 1,
  material_id text not null references public.ps_products (id) on delete restrict,
  -- Quantity per batch (yield), in the unit the chef writes the recipe in.
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  -- Material master unit at save time; conversion_factor turns 1 recipe unit into stock units.
  stock_unit text not null,
  conversion_factor numeric(16,8) not null default 1 check (conversion_factor > 0),
  stock_quantity numeric(16,6) generated always as (quantity * conversion_factor) stored,
  -- Trim / prep loss for this ingredient (peel, bones, trimming).
  wastage_percent numeric(5,2) not null default 0 check (wastage_percent between 0 and 100),
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, material_id)
);

create index if not exists idx_fb_recipe_ingredients_recipe on public.fb_recipe_ingredients (recipe_id, line_no);
create index if not exists idx_fb_recipe_ingredients_material on public.fb_recipe_ingredients (material_id);

create table if not exists public.fb_recipe_consumptions (
  id uuid primary key default gen_random_uuid(),
  consumption_no text not null unique,
  recipe_id uuid not null references public.fb_recipes (id) on delete restrict,
  source_type text not null default 'Manual'
    constraint fb_recipe_consumptions_source_type_check check (source_type in ('POS Sale', 'Manual')),
  -- fb_orders.id for POS sales; free text (event, staff meal…) for manual entries.
  source_ref text not null default '',
  menu_item_id uuid,
  portions numeric(12,3) not null check (portions > 0),
  warehouse_id text not null references public.ps_warehouses (id) on delete restrict,
  total_cost numeric(14,2) not null default 0,
  lines jsonb not null default '[]'::jsonb,
  remarks text not null default '',
  consumed_by text not null default '',
  consumed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- A settled order deducts each recipe once, even if payment is retried.
create unique index if not exists uq_fb_recipe_consumptions_pos_sale
  on public.fb_recipe_consumptions (source_ref, recipe_id)
  where source_type = 'POS Sale';
create index if not exists idx_fb_recipe_consumptions_recipe on public.fb_recipe_consumptions (recipe_id, consumed_at desc);

drop trigger if exists trg_fb_recipes_updated_at on public.fb_recipes;
create trigger trg_fb_recipes_updated_at
  before update on public.fb_recipes
  for each row execute function public.fnb_set_updated_at();

drop trigger if exists trg_fb_recipe_ingredients_updated_at on public.fb_recipe_ingredients;
create trigger trg_fb_recipe_ingredients_updated_at
  before update on public.fb_recipe_ingredients
  for each row execute function public.fnb_set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['fb_recipes', 'fb_recipe_ingredients', 'fb_recipe_consumptions']
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

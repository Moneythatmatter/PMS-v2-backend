-- F&B Masters: units, tax groups, modifier groups, outlet types
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists fb_units (
  id text primary key,
  code text not null,
  name text not null,
  symbol text default '',
  unit_type text default 'Count',
  decimal_places int default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_tax_groups (
  id text primary key,
  code text not null,
  name text not null,
  description text default '',
  tax_codes text default '',
  total_rate numeric default 0,
  applies_to text default '',
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_modifier_groups (
  id text primary key,
  code text,
  name text not null,
  options_count int default 0,
  min_select int default 0,
  max_select int default 1,
  is_required boolean default false,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_outlet_types (
  id text primary key,
  code text not null,
  name text not null,
  description text default '',
  has_tables text default 'Yes',
  has_kds text default 'No',
  status text default 'Active',
  created_at timestamptz default now()
);

-- RLS
do $$
declare
  t text;
begin
  foreach t in array array[
    'fb_units','fb_tax_groups','fb_modifier_groups','fb_outlet_types'
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

insert into fb_units (id, code, name, symbol, unit_type, decimal_places, status) values
  ('UN1', 'KG', 'Kilogram', 'kg', 'Weight', 2, 'Active'),
  ('UN2', 'LTR', 'Litre', 'L', 'Volume', 2, 'Active'),
  ('UN3', 'PCS', 'Pieces', 'pcs', 'Count', 0, 'Active'),
  ('UN4', 'GM', 'Gram', 'g', 'Weight', 0, 'Active')
on conflict (id) do nothing;

insert into fb_tax_groups (id, code, name, description, tax_codes, total_rate, applies_to, status) values
  ('TG1', 'TG-FOOD5', 'Food GST 5%', 'Standard food & non-AC dining', 'CGST2.5,SGST2.5', 5, 'Food', 'Active'),
  ('TG2', 'TG-LIQ18', 'Liquor GST 18%', 'Alcoholic beverages', 'CGST9,SGST9', 18, 'Liquor', 'Active'),
  ('TG3', 'TG-AC18', 'AC Dining 18%', 'Air-conditioned restaurant service', 'CGST9,SGST9', 18, 'AC Food', 'Active')
on conflict (id) do nothing;

insert into fb_modifier_groups (id, code, name, options_count, min_select, max_select, is_required, status) values
  ('MG1', 'MG-SPICE', 'Spice Level', 4, 1, 1, true, 'Active'),
  ('MG2', 'MG-TOP', 'Toppings', 8, 0, 5, false, 'Active'),
  ('MG3', 'MG-COOK', 'Cooking Preference', 3, 1, 1, true, 'Active')
on conflict (id) do nothing;

insert into fb_outlet_types (id, code, name, description, has_tables, has_kds, status) values
  ('OFT1', 'REST', 'Restaurant', 'Full-service dining with table management', 'Yes', 'Yes', 'Active'),
  ('OFT2', 'CAFE', 'Cafe', 'Quick-service cafe counter', 'Yes', 'Yes', 'Active'),
  ('OFT3', 'BAR', 'Bar', 'Bar service with bottle tracking', 'Yes', 'No', 'Active'),
  ('OFT5', 'KIT', 'Kitchen', 'Production kitchen — KDS only', 'No', 'Yes', 'Active')
on conflict (id) do nothing;

notify pgrst, 'schema cache';

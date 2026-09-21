-- Spare parts catalog master for Engineering Maintenance (mnt_spare_parts)
-- Safe to re-run. Requires properties table.

create table if not exists mnt_spare_parts (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  part_code text not null,
  part_name text not null,
  category text not null default '',
  unit text not null default 'Pcs',
  unit_cost numeric(12,2) not null default 0,
  default_stores_ref text,
  description text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_mnt_spare_parts_code
  on mnt_spare_parts (property_id, part_code);
create index if not exists idx_mnt_spare_parts_property_id on mnt_spare_parts (property_id);

do $$
begin
  alter table mnt_spare_parts enable row level security;
  drop policy if exists "anon_all_mnt_spare_parts" on mnt_spare_parts;
  create policy "anon_all_mnt_spare_parts" on mnt_spare_parts
    for all to anon using (true) with check (true);
end $$;

notify pgrst, 'reload schema';

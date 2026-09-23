-- Maintenance room + public area mirrors (like hk_rooms / public_areas)
-- Safe to re-run. Requires rooms + public_areas (+ properties) tables.

do $$
begin
  create type public.mnt_location_status as enum (
    'Operational',
    'Under Maintenance',
    'Out of Service'
  );
exception
  when duplicate_object then null;
end $$;

-- Guest rooms linked to FO rooms (auto-created on FO room create)
create table if not exists mnt_rooms (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  room_id text not null unique references rooms(id) on delete cascade,
  status public.mnt_location_status not null default 'Operational',
  notes text,
  last_serviced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mnt_rooms_property_id on mnt_rooms (property_id);
create index if not exists idx_mnt_rooms_status on mnt_rooms (status);

-- Public areas linked to HK/public_areas master (auto-created on HK public area create)
create table if not exists mnt_public_areas (
  id text primary key default gen_random_uuid()::text,
  property_id text not null references properties(id) on delete cascade,
  public_area_id text not null unique references public_areas(id) on delete cascade,
  status public.mnt_location_status not null default 'Operational',
  notes text,
  last_serviced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mnt_public_areas_property_id on mnt_public_areas (property_id);
create index if not exists idx_mnt_public_areas_status on mnt_public_areas (status);

-- Backfill existing FO rooms into mnt_rooms
insert into mnt_rooms (property_id, room_id, status)
select
  coalesce(
    nullif(r.property_id, ''),
    (select id from properties where is_default = true limit 1)
  ),
  r.id,
  'Operational'::public.mnt_location_status
from rooms r
where not exists (select 1 from mnt_rooms m where m.room_id = r.id)
  and coalesce(
    nullif(r.property_id, ''),
    (select id from properties where is_default = true limit 1)
  ) is not null
on conflict (room_id) do nothing;

-- Backfill existing public areas into mnt_public_areas
do $$
declare
  has_prop boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_areas' and column_name = 'property_id'
  ) into has_prop;

  if has_prop then
    insert into mnt_public_areas (property_id, public_area_id, status)
    select
      coalesce(p.property_id, (select id from properties where is_default = true limit 1)),
      p.id,
      'Operational'::public.mnt_location_status
    from public_areas p
    where not exists (select 1 from mnt_public_areas m where m.public_area_id = p.id)
      and coalesce(p.property_id, (select id from properties where is_default = true limit 1)) is not null
    on conflict (public_area_id) do nothing;
  else
    insert into mnt_public_areas (property_id, public_area_id, status)
    select
      (select id from properties where is_default = true limit 1),
      p.id,
      'Operational'::public.mnt_location_status
    from public_areas p
    where not exists (select 1 from mnt_public_areas m where m.public_area_id = p.id)
      and exists (select 1 from properties where is_default = true)
    on conflict (public_area_id) do nothing;
  end if;
end $$;

do $$
begin
  alter table mnt_rooms enable row level security;
  drop policy if exists "anon_all_mnt_rooms" on mnt_rooms;
  create policy "anon_all_mnt_rooms" on mnt_rooms
    for all to anon using (true) with check (true);

  alter table mnt_public_areas enable row level security;
  drop policy if exists "anon_all_mnt_public_areas" on mnt_public_areas;
  create policy "anon_all_mnt_public_areas" on mnt_public_areas
    for all to anon using (true) with check (true);
end $$;

notify pgrst, 'reload schema';

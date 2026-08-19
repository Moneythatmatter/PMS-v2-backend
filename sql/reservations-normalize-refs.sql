-- Patch: reservations — store guest_id + room_ref_id only (run once in Supabase SQL Editor)
-- Guest profile and room type come from guests + rooms via API joins.

-- 1. Add room_ref_id and backfill from legacy room_no
alter table public.reservations add column if not exists room_ref_id text;

update public.reservations
set room_ref_id = coalesce(nullif(trim(room_ref_id), ''), nullif(trim(room_no), ''))
where room_ref_id is null or trim(room_ref_id) = '';

-- 2. Backfill missing guest_id rows from denormalized guest fields
insert into public.guests (id, name, mobile, email, nationality, id_type, id_number)
select
  'G-MIG-' || substr(md5(r.id || coalesce(r.guest_name, '')), 1, 8),
  coalesce(nullif(trim(r.guest_name), ''), 'Unknown Guest'),
  coalesce(nullif(trim(r.phone), ''), ''),
  nullif(trim(r.email), ''),
  coalesce(nullif(trim(r.nationality), ''), ''),
  nullif(trim(r.id_proof_type), ''),
  nullif(trim(r.id_number), '')
from public.reservations r
where r.guest_id is null or trim(r.guest_id) = ''
on conflict (id) do nothing;

update public.reservations r
set guest_id = g.id
from public.guests g
where (r.guest_id is null or trim(r.guest_id) = '')
  and g.id = 'G-MIG-' || substr(md5(r.id || coalesce(r.guest_name, '')), 1, 8);

-- Merge identity fields into guest profile when present on booking
update public.guests g
set
  gender = coalesce(nullif(trim(g.gender), ''), nullif(trim(r.gender), '')),
  dob = coalesce(nullif(trim(g.dob), ''), nullif(trim(r.dob), '')),
  address = coalesce(nullif(trim(g.address), ''), nullif(trim(r.address), '')),
  city = coalesce(nullif(trim(g.city), ''), nullif(trim(r.city), '')),
  state = coalesce(nullif(trim(g.state), ''), nullif(trim(r.state), '')),
  country = coalesce(nullif(trim(g.country), ''), nullif(trim(r.country), '')),
  pincode = coalesce(nullif(trim(g.pincode), ''), nullif(trim(r.pincode), ''))
from public.reservations r
where r.guest_id = g.id
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'gender'
  );

alter table public.reservations alter column guest_id set not null;

-- 3. Drop denormalized booking columns
alter table public.reservations drop column if exists guest_name;
alter table public.reservations drop column if exists phone;
alter table public.reservations drop column if exists email;
alter table public.reservations drop column if exists room_no;
alter table public.reservations drop column if exists room_type;
alter table public.reservations drop column if exists gender;
alter table public.reservations drop column if exists dob;
alter table public.reservations drop column if exists nationality;
alter table public.reservations drop column if exists address;
alter table public.reservations drop column if exists city;
alter table public.reservations drop column if exists state;
alter table public.reservations drop column if exists country;
alter table public.reservations drop column if exists pincode;
alter table public.reservations drop column if exists id_proof_type;
alter table public.reservations drop column if exists id_number;

-- 4. Clear placeholder / invalid room refs (TBA, N/A, etc.) before FK
update public.reservations
set room_ref_id = null
where room_ref_id is not null
  and (
    trim(room_ref_id) = ''
    or upper(trim(room_ref_id)) in ('TBA', 'N/A', 'NA', 'UNASSIGNED', '-')
    or not exists (
      select 1 from public.rooms rm where rm.room_no = reservations.room_ref_id
    )
  );

-- 5. FK + indexes
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_room_ref_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_room_ref_id_fkey
      foreign key (room_ref_id) references public.rooms(room_no) on delete set null;
  end if;
end $$;

create index if not exists idx_reservations_guest_id on public.reservations(guest_id);
create index if not exists idx_reservations_room_ref_id on public.reservations(room_ref_id);

notify pgrst, 'schema cache';

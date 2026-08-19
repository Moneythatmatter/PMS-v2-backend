-- Recovery patch: reservations → guest_id + room_ref_id only
-- Safe to run from ANY partial state (fresh, half-migrated, or FK-failed).
-- Run once in Supabase SQL Editor, then run front-office-transactions.sql

-- ── 1. Ensure room_ref_id column exists ──
alter table public.reservations add column if not exists room_ref_id text;

-- Backfill from legacy room_no when that column still exists
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reservations'
      and column_name = 'room_no'
  ) then
    execute $sql$
      update public.reservations
      set room_ref_id = coalesce(
        nullif(trim(room_ref_id), ''),
        nullif(trim(room_no), '')
      )
      where room_ref_id is null or trim(room_ref_id) = ''
    $sql$;
  end if;
end $$;

-- ── 2. Guest backfill (only if legacy guest_name column exists) ──
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reservations'
      and column_name = 'guest_name'
  ) then
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
    where r.guest_id = g.id;
  end if;
end $$;

-- Require guest_id when every row has one
do $$
begin
  if not exists (
    select 1 from public.reservations
    where guest_id is null or trim(guest_id) = ''
  ) then
    alter table public.reservations alter column guest_id set not null;
  end if;
exception
  when others then
    raise notice 'guest_id NOT NULL skipped — some rows still missing guest_id';
end $$;

-- ── 3. Drop legacy denormalized columns (if present) ──
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

-- ── 4. Clear TBA / invalid room refs before FK ──
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

-- ── 5. FK + indexes ──
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

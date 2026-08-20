-- Front Office schema for Hotel PMS
-- Run once in Supabase SQL Editor

-- ========== MASTERS ==========
create table if not exists room_types (
  id text primary key,
  code text not null unique,
  name text not null,
  description text default '',
  base_rate numeric not null default 0,
  max_occupancy int not null default 2,
  max_adults int not null default 2,
  max_children int not null default 0,
  total_rooms int not null default 0,
  size_sq_ft int not null default 0,
  amenities text[] default '{}',
  status text not null default 'Active',
  created_at timestamptz default now()
);

create table if not exists rooms (
  id text primary key,
  room_no text not null unique,
  room_type text not null,
  floor text not null default '',
  max_occupancy int not null default 2,
  bed_type text not null default 'Queen',
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Upgrade: rooms.room_no PK → UUID id PK (room_no stays unique business key)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'room_no'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rooms' and column_name = 'id'
    ) then
      alter table public.rooms add column id text;
    end if;

    update public.rooms
    set id = gen_random_uuid()::text
    where id is null or trim(id) = '';

    alter table public.rooms alter column id set not null;

    alter table public.reservations drop constraint if exists reservations_room_ref_id_fkey;
    alter table public.hk_rooms drop constraint if exists hk_rooms_room_ref_id_fkey;

    update public.reservations r
    set room_ref_id = rm.id
    from public.rooms rm
    where r.room_ref_id is not null
      and trim(r.room_ref_id) <> ''
      and rm.room_no = r.room_ref_id
      and r.room_ref_id <> rm.id;

    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.rooms'::regclass
        and contype = 'p'
        and pg_get_constraintdef(oid) like '%room_no%'
    ) then
      alter table public.rooms drop constraint rooms_pkey;
      alter table public.rooms add primary key (id);
    end if;

    create unique index if not exists rooms_room_no_key on public.rooms(room_no);
  end if;
end $$;

-- Upgrade: rooms master slim (max_occupancy, bed_type, is_active, updated_at)
alter table public.rooms add column if not exists max_occupancy int not null default 2;
alter table public.rooms add column if not exists bed_type text not null default 'Queen';
alter table public.rooms add column if not exists is_active boolean not null default true;
alter table public.rooms add column if not exists updated_at timestamptz default now();

alter table public.rooms drop column if exists guest_name;
alter table public.rooms drop column if exists housekeeping;
alter table public.rooms drop column if exists maintenance;
alter table public.rooms drop column if exists checkout_date;

create or replace function public.rooms_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rooms_set_updated_at on public.rooms;
create trigger trg_rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.rooms_set_updated_at();

create table if not exists tariff_plans (
  id text primary key,
  code text not null unique,
  name text not null,
  room_type text not null default 'All Types',
  base_rate numeric not null default 0,
  weekend_rate numeric not null default 0,
  meal_plan text not null default 'EP',
  cancellation_policy text default '',
  min_nights int not null default 1,
  valid_from text,
  valid_to text,
  status text not null default 'Active',
  created_at timestamptz default now()
);

create table if not exists market_segments (
  id text primary key,
  code text not null unique,
  name text not null,
  category text not null,
  discount_percent numeric not null default 0,
  description text default '',
  contact_person text,
  commission_percent numeric,
  status text not null default 'Active',
  created_at timestamptz default now()
);

create table if not exists companies (
  id text primary key,
  code text not null unique,
  name text not null,
  type text not null,
  contact_person text not null default '',
  email text not null default '',
  phone text not null default '',
  gst_number text,
  address text default '',
  city text default '',
  corporate_discount numeric not null default 0,
  credit_limit numeric not null default 0,
  status text not null default 'Active',
  created_at timestamptz default now()
);

create table if not exists booking_sources (
  id text primary key,
  code text not null unique,
  name text not null,
  description text default '',
  status text not null default 'Active',
  created_at timestamptz default now()
);

-- ========== CORE ==========
create table if not exists guests (
  id text primary key,
  guest_no text unique,
  name text not null,
  mobile text not null default '',
  email text default '',
  nationality text default '',
  total_stays int not null default 0,
  loyalty_points int not null default 0,
  id_type text,
  id_number text,
  address text,
  member_since text,
  preferences text[] default '{}',
  gender text,
  dob text,
  city text,
  state text,
  country text,
  pincode text,
  created_at timestamptz default now()
);

-- Upgrade: legacy G-* guest ids → UUID v4
do $$
declare
  r record;
begin
  if exists (
    select 1 from public.guests
    where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    limit 1
  ) then
    create temporary table _guest_id_map (
      old_id text primary key,
      new_id text not null
    ) on commit drop;

    insert into _guest_id_map (old_id, new_id)
    select g2.id, gen_random_uuid()::text
    from public.guests g2
    where g2.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    for r in
      select c.conname, c.conrelid::regclass as child_table
      from pg_constraint c
      where c.confrelid = 'public.guests'::regclass and c.contype = 'f'
    loop
      execute format('alter table %s drop constraint %I', r.child_table, r.conname);
    end loop;

    update public.reservations r2
    set guest_id = m.new_id from _guest_id_map m where r2.guest_id = m.old_id;
    update public.guest_stay_history h
    set guest_id = m.new_id from _guest_id_map m where h.guest_id = m.old_id;
    update public.guests g2
    set id = m.new_id from _guest_id_map m where g2.id = m.old_id;

    alter table public.reservations
      add constraint reservations_guest_id_fkey
      foreign key (guest_id) references public.guests(id) on delete restrict;
    alter table public.guest_stay_history
      add constraint guest_stay_history_guest_id_fkey
      foreign key (guest_id) references public.guests(id) on delete cascade;
  end if;
exception
  when duplicate_object then null;
end $$;

-- Upgrade: auto-increment guest_no (G-0, G-1, …)
create sequence if not exists public.guests_guest_no_seq
  start with 0 increment by 1 minvalue 0;

alter table public.guests add column if not exists guest_no text;

do $$
begin
  if exists (
    select 1 from public.guests
    where guest_no is null or trim(guest_no) = ''
    limit 1
  ) then
    with numbered as (
      select
        id,
        (row_number() over (order by created_at nulls last, id) - 1)::bigint as n
      from public.guests
      where guest_no is null or trim(guest_no) = ''
    )
    update public.guests g
    set guest_no = 'G-' || numbered.n::text
    from numbered
    where g.id = numbered.id;
  end if;
end $$;

select setval(
  'public.guests_guest_no_seq',
  coalesce(
    (
      select max(
        case
          when guest_no ~ '^G-[0-9]+$'
            then substring(guest_no from 3)::bigint
          else null
        end
      )
      from public.guests
    ),
    -1
  ) + 1,
  false
);

create unique index if not exists guests_guest_no_key
  on public.guests (guest_no)
  where guest_no is not null and trim(guest_no) <> '';

create or replace function public.guests_assign_guest_no()
returns trigger language plpgsql as $$
begin
  if new.guest_no is null or trim(new.guest_no) = '' then
    new.guest_no := 'G-' || nextval('public.guests_guest_no_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guests_assign_guest_no on public.guests;
create trigger trg_guests_assign_guest_no
  before insert on public.guests
  for each row execute function public.guests_assign_guest_no();

create table if not exists reservations (
  id text primary key,
  booking_no text unique,
  guest_id text not null references guests(id) on delete restrict,
  room_ref_id text references rooms(id) on delete set null,
  source_id text references booking_sources(id) on delete set null,
  check_in text not null,
  check_out text not null,
  balance numeric not null default 0,
  status text not null default 'Confirmed',
  arriving_today boolean default false,
  booking_type text default 'Individual',
  company_name text,
  adults int default 1,
  children int default 0,
  nights int default 1,
  tariff_plan text,
  meal_plan text,
  room_rate numeric default 0,
  total_amount numeric default 0,
  advance_paid numeric default 0,
  payment_mode text,
  special_requests text,
  booked_by text,
  created_at text,
  restaurant_bill numeric default 0,
  laundry numeric default 0,
  is_vip boolean default false
);

-- Upgrade: legacy BK-* reservation ids → UUID v4
do $$
declare
  r record;
begin
  if exists (
    select 1 from public.reservations
    where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    limit 1
  ) then
    create temporary table _reservation_id_map (
      old_id text primary key,
      new_id text not null
    ) on commit drop;

    insert into _reservation_id_map (old_id, new_id)
    select r2.id, gen_random_uuid()::text
    from public.reservations r2
    where r2.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    for r in
      select c.conname, c.conrelid::regclass as child_table
      from pg_constraint c
      where c.confrelid = 'public.reservations'::regclass and c.contype = 'f'
    loop
      execute format('alter table %s drop constraint %I', r.child_table, r.conname);
    end loop;

    update public.folio_entries f
    set reservation_id = m.new_id from _reservation_id_map m where f.reservation_id = m.old_id;
    update public.payments p
    set reservation_id = m.new_id from _reservation_id_map m where p.reservation_id = m.old_id;
    update public.reservations r2
    set id = m.new_id from _reservation_id_map m where r2.id = m.old_id;

    alter table public.folio_entries
      add constraint folio_entries_reservation_id_fkey
      foreign key (reservation_id) references public.reservations(id) on delete set null;
    alter table public.payments
      add constraint payments_reservation_id_fkey
      foreign key (reservation_id) references public.reservations(id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

-- Upgrade: auto-increment booking_no (BK-0, BK-1, …)
create sequence if not exists public.reservations_booking_no_seq
  start with 0 increment by 1 minvalue 0;

alter table public.reservations add column if not exists booking_no text;

do $$
begin
  if exists (
    select 1 from public.reservations
    where booking_no is null or trim(booking_no) = ''
    limit 1
  ) then
    with numbered as (
      select
        id,
        (row_number() over (order by created_at nulls last, id) - 1)::bigint as n
      from public.reservations
      where booking_no is null or trim(booking_no) = ''
    )
    update public.reservations r
    set booking_no = 'BK-' || numbered.n::text
    from numbered
    where r.id = numbered.id;
  end if;
end $$;

select setval(
  'public.reservations_booking_no_seq',
  coalesce(
    (
      select max(
        case
          when booking_no ~ '^BK-[0-9]+$'
            then substring(booking_no from 4)::bigint
          else null
        end
      )
      from public.reservations
    ),
    -1
  ) + 1,
  false
);

create unique index if not exists reservations_booking_no_key
  on public.reservations (booking_no)
  where booking_no is not null and trim(booking_no) <> '';

create or replace function public.reservations_assign_booking_no()
returns trigger language plpgsql as $$
begin
  if new.booking_no is null or trim(new.booking_no) = '' then
    new.booking_no := 'BK-' || nextval('public.reservations_booking_no_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reservations_assign_booking_no on public.reservations;
create trigger trg_reservations_assign_booking_no
  before insert on public.reservations
  for each row execute function public.reservations_assign_booking_no();

-- Upgrade existing DBs: migrate denormalized reservations → guest_id + room_ref_id
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'guest_name'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reservations' and column_name = 'room_ref_id'
    ) then
      alter table public.reservations add column room_ref_id text;
    end if;

    update public.reservations
    set room_ref_id = coalesce(nullif(trim(room_ref_id), ''), nullif(trim(room_no), ''))
    where room_ref_id is null or trim(room_ref_id) = '';

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
    where r.guest_id = g.id
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'reservations' and column_name = 'gender'
      );

    alter table public.reservations alter column guest_id set not null;

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
  end if;

  -- Clear placeholder / invalid room refs before FK (TBA is not in rooms)
  update public.reservations
  set room_ref_id = null
  where room_ref_id is not null
    and (
      trim(room_ref_id) = ''
      or upper(trim(room_ref_id)) in ('TBA', 'N/A', 'NA', 'UNASSIGNED', '-')
      or not exists (
        select 1 from public.rooms rm where rm.id = reservations.room_ref_id
      )
      or not exists (
        select 1 from public.rooms rm where rm.room_no = reservations.room_ref_id
      )
    );

  -- Remap room_ref_id from room_no → rooms.id when rooms uses UUID PK
  update public.reservations r
  set room_ref_id = rm.id
  from public.rooms rm
  where r.room_ref_id is not null
    and trim(r.room_ref_id) <> ''
    and rm.room_no = r.room_ref_id
    and r.room_ref_id <> rm.id;

  update public.reservations
  set room_ref_id = null
  where room_ref_id is not null
    and trim(room_ref_id) <> ''
    and not exists (select 1 from public.rooms rm where rm.id = reservations.room_ref_id);

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_room_ref_id_fkey'
  ) then
    alter table public.reservations
      add constraint reservations_room_ref_id_fkey
      foreign key (room_ref_id) references public.rooms(id) on delete set null;
  end if;
end $$;

create table if not exists guest_stay_history (
  id text primary key,
  guest_id text not null references guests(id) on delete cascade,
  check_in text not null,
  check_out text not null,
  room text,
  room_type text,
  amount numeric not null default 0,
  created_at timestamptz default now()
);

-- ========== BILLING ==========
create table if not exists folio_entries (
  id text primary key,
  guest_name text not null,
  room text not null,
  reservation_id text references reservations(id) on delete set null,
  date text not null,
  description text not null,
  category text not null,
  debit numeric not null default 0,
  credit numeric not null default 0,
  balance numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists payments (
  id text primary key,
  guest_name text not null,
  room text,
  reservation_id text references reservations(id) on delete set null,
  amount numeric not null,
  mode text not null,
  type text not null default 'Payment',
  transaction_no text not null,
  date text not null,
  status text not null default 'Completed',
  created_at timestamptz default now()
);

create table if not exists invoices (
  id text primary key,
  invoice_no text not null unique,
  guest text not null,
  room text,
  room_type text,
  booking_id text,
  phone text,
  email text,
  check_in text,
  check_out text,
  nights int default 1,
  adults int default 1,
  children int default 0,
  room_charges numeric default 0,
  restaurant_charges numeric default 0,
  laundry numeric default 0,
  mini_bar numeric default 0,
  extra_bed numeric default 0,
  other_charges numeric default 0,
  discount numeric default 0,
  subtotal numeric default 0,
  gst numeric default 0,
  payment numeric default 0,
  date text,
  status text default 'Pending',
  payment_mode text,
  created_at timestamptz default now()
);

-- ========== OPS ==========
create table if not exists room_transfers (
  id text primary key,
  guest_name text not null,
  from_room text not null,
  to_room text not null,
  date text not null,
  reason text default '',
  status text not null default 'Pending',
  created_at timestamptz default now()
);

create table if not exists wake_up_calls (
  id text primary key,
  guest text not null,
  room text not null,
  date text not null,
  time text not null,
  notes text,
  completed boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists taxi_bookings (
  id text primary key,
  guest text not null,
  room text not null,
  pickup text not null,
  drop_location text not null,
  date text not null,
  time text not null,
  driver text default '',
  vehicle text default '',
  fare numeric not null default 0,
  status text not null default 'Scheduled',
  created_at timestamptz default now()
);

create table if not exists luggage_items (
  id text primary key,
  guest text not null,
  room text not null,
  bag_count int not null default 1,
  token_no text not null,
  stored text not null,
  location text not null,
  returned text,
  status text not null default 'Stored',
  created_at timestamptz default now()
);

create table if not exists messages (
  id text primary key,
  type text not null default 'Guest',
  subject text not null,
  body text not null default '',
  guest text not null,
  room text,
  date text not null,
  read boolean not null default false,
  priority text not null default 'Normal',
  created_at timestamptz default now()
);

create table if not exists guest_feedback (
  id text primary key,
  guest text not null,
  room text not null,
  date text not null,
  rating numeric not null default 0,
  cleanliness numeric not null default 0,
  food numeric not null default 0,
  service numeric not null default 0,
  comments text default '',
  created_at timestamptz default now()
);

create table if not exists lost_found_items (
  id text primary key,
  item text not null,
  guest text default '',
  found_by text default '',
  room text default '',
  found_date text not null,
  description text,
  status text not null default 'Stored',
  returned_date text,
  created_at timestamptz default now()
);

create table if not exists housekeeping_requests (
  id text primary key,
  guest text default '',
  room text not null,
  booking_id text references reservations(id) on delete set null,
  issue text not null,
  priority text not null default 'Medium',
  status text not null default 'Open',
  assigned_staff text default '',
  created_at_label text,
  assignment_type text,
  assignment_history jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ========== MAINTENANCE REQUESTS (slim ops) ==========
do $$
begin
  create type public.maintenance_issue_type as enum (
    'ELECTRICAL',
    'PLUMBING',
    'HVAC',
    'CARPENTRY',
    'CIVIL',
    'APPLIANCE',
    'IT',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.maintenance_request_status as enum (
    'OPEN',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_VERIFICATION',
    'CLOSED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.maintenance_request_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.maintenance_requests_request_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists maintenance_requests (
  id text primary key default gen_random_uuid()::text,
  request_number text,
  room_id text references rooms(id) on delete set null,
  public_area_id text,
  issue_type public.maintenance_issue_type not null default 'OTHER',
  title text not null,
  description text not null,
  priority public.maintenance_request_priority not null default 'MEDIUM',
  status public.maintenance_request_status not null default 'OPEN',
  reported_by text,
  assigned_to text,
  reported_at timestamptz default now(),
  assigned_at timestamptz,
  started_at timestamptz,
  estimated_completion_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  resolution text,
  notes text,
  blocks_room boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint maintenance_requests_location_chk check (
    room_id is not null or public_area_id is not null
  )
);

create unique index if not exists maintenance_requests_request_number_key
  on maintenance_requests (request_number)
  where request_number is not null and trim(request_number) <> '';

-- reported_by / assigned_to / verified_by store hk_staff.id or display name (no users FK)

create or replace function public.maintenance_requests_assign_request_number()
returns trigger language plpgsql as $$
begin
  if new.request_number is null or trim(new.request_number) = '' then
    new.request_number := 'MR-' || nextval('public.maintenance_requests_request_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_maintenance_requests_assign_request_number on maintenance_requests;
create trigger trg_maintenance_requests_assign_request_number
  before insert on maintenance_requests for each row
  execute function public.maintenance_requests_assign_request_number();

create or replace function public.maintenance_requests_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_maintenance_requests_set_updated_at on maintenance_requests;
create trigger trg_maintenance_requests_set_updated_at
  before update on maintenance_requests for each row
  execute function public.maintenance_requests_set_updated_at();

-- ========== CLOSING ==========
create table if not exists cashier_shifts (
  id text primary key,
  cashier text not null,
  shift text not null,
  date text not null,
  expected numeric not null default 0,
  actual numeric not null default 0,
  variance numeric not null default 0,
  status text not null default 'Open',
  cash_expected numeric default 0,
  card_expected numeric default 0,
  upi_expected numeric default 0,
  refunds numeric default 0,
  created_at timestamptz default now()
);

create table if not exists room_charge_postings (
  id text primary key,
  room_no text not null,
  guest_name text not null,
  room_rate numeric not null default 0,
  extras numeric not null default 0,
  status text not null default 'Pending',
  created_at timestamptz default now()
);

create table if not exists day_closings (
  id text primary key,
  business_date text not null,
  total_revenue numeric default 0,
  room_revenue numeric default 0,
  fb_revenue numeric default 0,
  other_revenue numeric default 0,
  occupancy numeric default 0,
  arrivals int default 0,
  departures int default 0,
  in_house int default 0,
  pending_checkouts int default 0,
  closed_at text,
  closed_by text,
  next_business_date text,
  steps jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists desk_activity (
  id text primary key,
  message text not null,
  timestamp text not null,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_reservations_status on reservations(status);
create index if not exists idx_reservations_check_in on reservations(check_in);
create index if not exists idx_reservations_guest_id on reservations(guest_id);
create index if not exists idx_reservations_room_ref_id on reservations(room_ref_id);
create index if not exists idx_reservations_source_id on reservations(source_id);
create index if not exists idx_folio_room on folio_entries(room);
create index if not exists idx_payments_date on payments(date);

-- RLS: allow anon full access (prototype)
alter table room_types enable row level security;
alter table rooms enable row level security;
alter table tariff_plans enable row level security;
alter table market_segments enable row level security;
alter table companies enable row level security;
alter table booking_sources enable row level security;
alter table guests enable row level security;
alter table reservations enable row level security;
alter table guest_stay_history enable row level security;
alter table folio_entries enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table room_transfers enable row level security;
alter table wake_up_calls enable row level security;
alter table taxi_bookings enable row level security;
alter table luggage_items enable row level security;
alter table messages enable row level security;
alter table guest_feedback enable row level security;
alter table lost_found_items enable row level security;
alter table housekeeping_requests enable row level security;
alter table maintenance_requests enable row level security;
alter table cashier_shifts enable row level security;
alter table room_charge_postings enable row level security;
alter table day_closings enable row level security;
alter table desk_activity enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'room_types','rooms','tariff_plans','market_segments','companies','booking_sources',
    'guests','reservations','guest_stay_history','folio_entries','payments',
    'invoices','room_transfers','wake_up_calls','taxi_bookings','luggage_items',
    'messages','guest_feedback','lost_found_items','housekeeping_requests',
    'maintenance_requests','cashier_shifts','room_charge_postings',
    'day_closings','desk_activity'
  ]
  loop
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ========== SEED ==========
insert into room_types (id, code, name, description, base_rate, max_occupancy, max_adults, max_children, total_rooms, size_sq_ft, amenities, status) values
  ('RT-01','STD','Standard','Comfortable room with essential amenities',2800,2,2,1,24,220,array['Wi-Fi','AC','TV','Work Desk'],'Active'),
  ('RT-02','DLX','Deluxe','Spacious room with premium bedding',4200,3,2,2,18,320,array['Wi-Fi','AC','Smart TV','Mini Bar','Bathtub'],'Active'),
  ('RT-03','STE','Suite','Luxury suite with separate living area',8500,4,3,2,8,580,array['Wi-Fi','AC','Smart TV','Mini Bar','Jacuzzi'],'Active'),
  ('RT-04','PRM','Premium','Top-floor premium rooms',6200,3,2,1,6,400,array['Wi-Fi','AC','Smart TV','Mini Bar','Balcony'],'Active')
on conflict (id) do nothing;

insert into tariff_plans (id, code, name, room_type, base_rate, weekend_rate, meal_plan, cancellation_policy, min_nights, valid_from, valid_to, status) values
  ('RP-01','BAR','Best Available Rate','All Types',3500,4200,'EP','Free cancellation 24 hrs before arrival',1,'2026-01-01','2026-12-31','Active'),
  ('RP-02','CORP','Corporate Rate','Standard, Deluxe',3200,3200,'CP','Free cancellation 48 hrs before arrival',1,'2026-01-01','2026-12-31','Active'),
  ('RP-03','WKND','Weekend Package','Deluxe, Suite',4800,4800,'MAP','Non-refundable',2,'2026-01-01','2026-12-31','Active'),
  ('RP-04','OTA','OTA Rate','All Types',3000,3600,'EP','As per OTA policy',1,'2026-01-01','2026-12-31','Active')
on conflict (id) do nothing;

insert into market_segments (id, code, name, category, discount_percent, description, status) values
  ('MS-01','CORP','Corporate','Corporate',15,'Business travellers and company accounts','Active'),
  ('MS-02','LEIS','Leisure','Leisure',5,'Vacation and leisure guests','Active'),
  ('MS-03','OTA','Online Travel','OTA',10,'Booking.com, Agoda, MakeMyTrip','Active'),
  ('MS-04','GOVT','Government','Government',20,'Government and PSU bookings','Active'),
  ('MS-05','GRP','Group','Group',12,'Tour groups and events','Active')
on conflict (id) do nothing;

insert into companies (id, code, name, type, contact_person, email, phone, address, city, corporate_discount, credit_limit, status) values
  ('CO-01','TCS','Tata Consultancy','Corporate','Amit Shah','amit@tcs.com','+91 98765 11111','TCS Campus','Mumbai',15,500000,'Active'),
  ('CO-02','INFY','Infosys Ltd','Corporate','Priya Nair','priya@infosys.com','+91 98765 22222','Electronics City','Bangalore',12,400000,'Active'),
  ('CO-03','MMT','MakeMyTrip','Travel Agent','Ravi Kumar','ravi@mmt.com','+91 98765 33333','Gurugram','Delhi NCR',8,200000,'Active')
on conflict (id) do nothing;

insert into booking_sources (id, code, name, description, status) values
  ('770e8400-e29b-41d4-a716-446655440001','WALKIN','Walk-in','Guest arrived at front desk without prior booking','Active'),
  ('770e8400-e29b-41d4-a716-446655440002','WEB','Website','Direct booking via hotel website','Active'),
  ('770e8400-e29b-41d4-a716-446655440003','BCOM','Booking.com','OTA — Booking.com','Active'),
  ('770e8400-e29b-41d4-a716-446655440004','AGODA','Agoda','OTA — Agoda','Active'),
  ('770e8400-e29b-41d4-a716-446655440005','MMT','MakeMyTrip','OTA — MakeMyTrip','Active'),
  ('770e8400-e29b-41d4-a716-446655440006','TA','Travel Agent','Booked through travel agent','Active'),
  ('770e8400-e29b-41d4-a716-446655440007','CORP','Corporate','Corporate / company booking','Active')
on conflict (id) do nothing;

insert into rooms (id, room_no, room_type, floor, max_occupancy, bed_type, is_active) values
  (gen_random_uuid()::text,'101','Standard','1st Floor',2,'Queen',true),
  (gen_random_uuid()::text,'102','Standard','1st Floor',2,'Queen',true),
  (gen_random_uuid()::text,'103','Deluxe','1st Floor',3,'King',true),
  (gen_random_uuid()::text,'104','Deluxe','1st Floor',3,'King',false),
  (gen_random_uuid()::text,'105','Standard','1st Floor',2,'Twin',true),
  (gen_random_uuid()::text,'112','Standard','1st Floor',2,'Queen',true),
  (gen_random_uuid()::text,'204','Deluxe','2nd Floor',3,'King',true),
  (gen_random_uuid()::text,'305','Deluxe','3rd Floor',3,'King',true),
  (gen_random_uuid()::text,'308','Deluxe','3rd Floor',3,'King',true),
  (gen_random_uuid()::text,'501','Suite','5th Floor',4,'King',true),
  (gen_random_uuid()::text,'602','Suite','6th Floor',4,'King',true)
on conflict (room_no) do nothing;

insert into guests (id, guest_no, name, mobile, email, nationality, total_stays, loyalty_points, id_type, id_number, member_since) values
  ('660e8400-e29b-41d4-a716-446655440001','G-0','Rahul Sharma','+91 98765 43210','rahul@email.com','Indian',5,1200,'Aadhaar','XXXX-XXXX-4521','2024-01-15'),
  ('660e8400-e29b-41d4-a716-446655440002','G-1','James Wilson','+91 87654 32109','james.w@email.com','British',3,800,'Passport','GB9823412','2024-06-01'),
  ('660e8400-e29b-41d4-a716-446655440003','G-2','Anita Desai','+91 76543 21098','anita.d@email.com','Indian',2,400,'Driving Licence','DL-MH-2019-8821','2025-02-10'),
  ('660e8400-e29b-41d4-a716-446655440004','G-3','Priya Patel','+91 99887 76655','priya@email.com','Indian',8,2500,'Aadhaar','XXXX-XXXX-8899','2023-08-20'),
  ('660e8400-e29b-41d4-a716-446655440005','G-4','Michael Brown','+91 88776 65544','m.brown@corp.com','American',4,1100,'Passport','US4412299','2024-11-05'),
  ('660e8400-e29b-41d4-a716-446655440006','G-5','Sneha Reddy','+91 91234 56789','sneha.r@email.com','Indian',0,0,null,null,'2026-06-22')
on conflict (id) do nothing;

insert into reservations (id, booking_no, guest_id, room_ref_id, source_id, check_in, check_out, balance, status, arriving_today, adults, children, nights, tariff_plan, meal_plan, room_rate, total_amount, advance_paid, payment_mode, special_requests, created_at, booked_by, restaurant_bill, laundry, is_vip) values
  ('550e8400-e29b-41d4-a716-446655440001','BK-0','660e8400-e29b-41d4-a716-446655440001',(select id from rooms where room_no='204' limit 1),'770e8400-e29b-41d4-a716-446655440001','23 Jun 2026','26 Jun 2026',8500,'Checked In',false,2,0,3,'BAR','CP',4500,13500,5000,'UPI','Late check-in requested','20 Jun 2026, 2:30 PM','Front Desk — Amit',620,180,false),
  ('550e8400-e29b-41d4-a716-446655440002','BK-1','660e8400-e29b-41d4-a716-446655440002',(select id from rooms where room_no='112' limit 1),'770e8400-e29b-41d4-a716-446655440003','22 Jun 2026','27 Jun 2026',3200,'Checked In',false,1,0,5,'OTA','EP',3200,16000,12800,'Card',null,'18 Jun 2026, 11:00 AM','Online — Booking.com',850,200,false),
  ('550e8400-e29b-41d4-a716-446655440003','BK-2','660e8400-e29b-41d4-a716-446655440003',(select id from rooms where room_no='308' limit 1),'770e8400-e29b-41d4-a716-446655440004','23 Jun 2026','24 Jun 2026',5500,'Reserved',true,2,1,1,'OTA','MAP',5500,5500,0,'Pay at Hotel','Crib required','21 Jun 2026, 4:15 PM','Online — Agoda',0,0,false),
  ('550e8400-e29b-41d4-a716-446655440004','BK-3','660e8400-e29b-41d4-a716-446655440004',(select id from rooms where room_no='501' limit 1),'770e8400-e29b-41d4-a716-446655440007','22 Jun 2026','27 Jun 2026',12400,'Checked In',false,2,1,5,'CORP','MAP',8500,42500,30100,'Card',null,'15 Jun 2026, 9:00 AM','Sales — Neha',1200,450,true),
  ('550e8400-e29b-41d4-a716-446655440005','BK-4','660e8400-e29b-41d4-a716-446655440005',(select id from rooms where room_no='305' limit 1),'770e8400-e29b-41d4-a716-446655440007','21 Jun 2026','24 Jun 2026',5600,'Checked In',false,1,0,3,'CORP','CP',4200,12600,7000,'Card',null,'19 Jun 2026, 3:00 PM','Front Desk — Amit',940,320,true),
  ('550e8400-e29b-41d4-a716-446655440006','BK-5','660e8400-e29b-41d4-a716-446655440006',(select id from rooms where room_no='102' limit 1),'770e8400-e29b-41d4-a716-446655440005','24 Jun 2026','26 Jun 2026',6400,'Confirmed',true,2,0,2,'OTA','EP',3200,6400,0,'Pay at Hotel',null,'22 Jun 2026, 1:00 PM','Online — MMT',0,0,false)
on conflict (id) do nothing;

insert into folio_entries (id, guest_name, room, reservation_id, date, description, category, debit, credit, balance) values
  ('FE-01','James Wilson','112','550e8400-e29b-41d4-a716-446655440002','22 Jun 2026','Room Charge — Night 1','Room',3200,0,3200),
  ('FE-02','James Wilson','112','550e8400-e29b-41d4-a716-446655440002','22 Jun 2026','Advance Payment','Payment',0,12800,-9600),
  ('FE-03','James Wilson','112','550e8400-e29b-41d4-a716-446655440002','23 Jun 2026','Restaurant — Dinner','Restaurant',850,0,-8750),
  ('FE-04','Rahul Sharma','204','550e8400-e29b-41d4-a716-446655440001','23 Jun 2026','Room Charge — Night 1','Room',4500,0,4500),
  ('FE-05','Rahul Sharma','204','550e8400-e29b-41d4-a716-446655440001','23 Jun 2026','Advance Payment','Payment',0,5000,-500)
on conflict (id) do nothing;

insert into payments (id, guest_name, room, reservation_id, amount, mode, type, transaction_no, date, status) values
  ('PAY-01','James Wilson','112','550e8400-e29b-41d4-a716-446655440002',12800,'Card','Advance','TXN-8821','18 Jun 2026','Completed'),
  ('PAY-02','Rahul Sharma','204','550e8400-e29b-41d4-a716-446655440001',5000,'UPI','Advance','TXN-8822','20 Jun 2026','Completed'),
  ('PAY-03','Priya Patel','501','550e8400-e29b-41d4-a716-446655440004',30100,'Card','Advance','TXN-8823','15 Jun 2026','Completed')
on conflict (id) do nothing;

insert into wake_up_calls (id, guest, room, date, time, notes, completed) values
  ('WU-01','James Wilson','112','24 Jun 2026','06:30','Early flight',false),
  ('WU-02','Priya Patel','501','24 Jun 2026','07:00',null,false)
on conflict (id) do nothing;

insert into taxi_bookings (id, guest, room, pickup, drop_location, date, time, driver, vehicle, fare, status) values
  ('TX-01','James Wilson','112','Hotel Lobby','Airport T2','24 Jun 2026','05:00','Ramesh','Sedan',850,'Scheduled')
on conflict (id) do nothing;

insert into messages (id, type, subject, body, guest, room, date, read, priority) values
  ('MSG-01','Guest','Late checkout request','Guest requests late checkout till 2 PM','Priya Patel','501','23 Jun 2026',false,'High'),
  ('MSG-02','Internal','VIP arrival','VIP guest arriving tomorrow — prepare suite amenities','Priya Patel','501','22 Jun 2026',true,'Normal')
on conflict (id) do nothing;

insert into guest_feedback (id, guest, room, date, rating, cleanliness, food, service, comments) values
  ('FB-01','Anita Desai','308','20 Jun 2026',4,5,4,4,'Great stay, staff was helpful')
on conflict (id) do nothing;

insert into cashier_shifts (id, cashier, shift, date, expected, actual, variance, status, cash_expected, card_expected, upi_expected, refunds) values
  ('CS-01','Amit Kumar','Morning','23 Jun 2026',45000,44800,-200,'Closed',12000,25000,8000,500),
  ('CS-02','Neha Singh','Evening','23 Jun 2026',32000,0,0,'Open',8000,18000,6000,0)
on conflict (id) do nothing;

insert into desk_activity (id, message, timestamp) values
  ('DA-01','Check-in completed — James Wilson, Room 112','10:15 AM'),
  ('DA-02','New reservation — Sneha Reddy via MakeMyTrip','11:02 AM'),
  ('DA-03','Room transfer requested — Michael Brown','11:45 AM'),
  ('DA-04','Payment received — Priya Patel, ₹30,100','12:10 PM')
on conflict (id) do nothing;

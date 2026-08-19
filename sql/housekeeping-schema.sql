-- Housekeeping schema for Hotel PMS
-- Run in Supabase SQL Editor after front-office-schema.sql
-- Shared FO tables (maintenance_requests, luggage_items, lost_found_items)
-- are reused via /api/housekeeping/maintenance|lost-found
-- After base schema, run: maintenance-requests.sql, lost-found-items.sql
-- Guest requests live in guest_requests (see below)

-- ========== ROOMS (slim ops — inventory lives on FO `rooms`) ==========
do $$
begin
  create type public.hk_room_status as enum (
    'CLEAN',
    'DIRTY',
    'INSPECTING',
    'INSPECTED',
    'OUT_OF_SERVICE'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists hk_rooms (
  id text primary key default gen_random_uuid()::text,
  room_id text not null unique references rooms(id) on delete cascade,
  status public.hk_room_status not null default 'DIRTY',
  assigned_to text,
  inspected_by text,
  last_cleaned_at timestamptz,
  last_inspected_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    alter table hk_rooms drop constraint if exists hk_rooms_assigned_to_fkey;
    alter table hk_rooms
      add constraint hk_rooms_assigned_to_fkey
      foreign key (assigned_to) references users(id) on delete set null;

    alter table hk_rooms drop constraint if exists hk_rooms_inspected_by_fkey;
    alter table hk_rooms
      add constraint hk_rooms_inspected_by_fkey
      foreign key (inspected_by) references users(id) on delete set null;
  end if;
exception
  when others then null;
end $$;

create or replace function public.hk_rooms_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hk_rooms_set_updated_at on hk_rooms;

create trigger trg_hk_rooms_set_updated_at
  before update on hk_rooms
  for each row
  execute function public.hk_rooms_set_updated_at();

-- ========== HOUSEKEEPING TASKS ==========
do $$
begin
  create type public.hk_task_type as enum (
    'CHECKOUT_CLEANING',
    'REGULAR_CLEANING',
    'DEEP_CLEANING',
    'INSPECTION',
    'TURNDOWN',
    'SPECIAL_REQUEST'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hk_task_status as enum (
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'APPROVED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.hk_task_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.housekeeping_tasks_task_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists housekeeping_tasks (
  id text primary key default gen_random_uuid()::text,
  task_number text,
  room_id text not null references rooms(id) on delete cascade,
  booking_id text references reservations(id) on delete set null,
  task_type public.hk_task_type not null default 'REGULAR_CLEANING',
  status public.hk_task_status not null default 'PENDING',
  assigned_to text,
  created_by text,
  priority public.hk_task_priority not null default 'MEDIUM',
  notes text,
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists housekeeping_tasks_task_number_key
  on housekeeping_tasks (task_number)
  where task_number is not null and trim(task_number) <> '';

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    alter table housekeeping_tasks drop constraint if exists housekeeping_tasks_assigned_to_fkey;
    alter table housekeeping_tasks
      add constraint housekeeping_tasks_assigned_to_fkey
      foreign key (assigned_to) references users(id) on delete set null;
    alter table housekeeping_tasks drop constraint if exists housekeeping_tasks_created_by_fkey;
    alter table housekeeping_tasks
      add constraint housekeeping_tasks_created_by_fkey
      foreign key (created_by) references users(id) on delete set null;
    alter table housekeeping_tasks drop constraint if exists housekeeping_tasks_approved_by_fkey;
    alter table housekeeping_tasks
      add constraint housekeeping_tasks_approved_by_fkey
      foreign key (approved_by) references users(id) on delete set null;
  end if;
exception
  when others then null;
end $$;

create or replace function public.housekeeping_tasks_assign_task_number()
returns trigger language plpgsql as $$
begin
  if new.task_number is null or trim(new.task_number) = '' then
    new.task_number := 'HT-' || nextval('public.housekeeping_tasks_task_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_housekeeping_tasks_assign_task_number on housekeeping_tasks;
create trigger trg_housekeeping_tasks_assign_task_number
  before insert on housekeeping_tasks for each row
  execute function public.housekeeping_tasks_assign_task_number();

create or replace function public.housekeeping_tasks_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_housekeeping_tasks_set_updated_at on housekeeping_tasks;
create trigger trg_housekeeping_tasks_set_updated_at
  before update on housekeeping_tasks for each row
  execute function public.housekeeping_tasks_set_updated_at();

create or replace function public.hk_ensure_room_dirty(p_room_id text)
returns void language plpgsql as $$
begin
  if p_room_id is null or trim(p_room_id) = '' then return; end if;
  insert into hk_rooms (room_id, status)
  values (p_room_id, 'DIRTY'::public.hk_room_status)
  on conflict (room_id) do update
    set status = 'DIRTY'::public.hk_room_status, updated_at = now();
end;
$$;

create or replace function public.hk_create_checkout_task(
  p_room_id text,
  p_booking_id text,
  p_notes text default null,
  p_created_by text default null
)
returns text language plpgsql as $$
declare v_task_id text;
begin
  if p_room_id is null or trim(p_room_id) = '' then return null; end if;
  perform public.hk_ensure_room_dirty(p_room_id);
  if p_booking_id is not null and trim(p_booking_id) <> '' then
    select id into v_task_id from housekeeping_tasks
    where booking_id = p_booking_id
      and task_type = 'CHECKOUT_CLEANING'::public.hk_task_type
      and status not in ('APPROVED'::public.hk_task_status, 'CANCELLED'::public.hk_task_status)
    limit 1;
    if v_task_id is not null then return v_task_id; end if;
  end if;
  insert into housekeeping_tasks (room_id, booking_id, task_type, status, priority, notes, created_by)
  values (
    p_room_id,
    nullif(trim(coalesce(p_booking_id, '')), ''),
    'CHECKOUT_CLEANING'::public.hk_task_type,
    'PENDING'::public.hk_task_status,
    'HIGH'::public.hk_task_priority,
    coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Auto-created on guest checkout'),
    nullif(trim(coalesce(p_created_by, '')), '')
  )
  returning id into v_task_id;
  return v_task_id;
end;
$$;

-- ========== GUEST REQUESTS ==========
do $$
begin
  create type public.guest_request_type as enum (
    'AMENITY',
    'LINEN',
    'TOWELS',
    'CLEANING',
    'LAUNDRY',
    'MINIBAR',
    'MAINTENANCE',
    'ROOM_SERVICE',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.guest_request_status as enum (
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.guest_request_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
exception
  when duplicate_object then null;
end $$;

create sequence if not exists public.guest_requests_request_number_seq
  start with 0
  increment by 1
  minvalue 0;

create table if not exists guest_requests (
  id text primary key default gen_random_uuid()::text,
  request_number text,
  room_id text not null references rooms(id) on delete cascade,
  booking_id text references reservations(id) on delete set null,
  request_type public.guest_request_type not null default 'OTHER',
  description text not null,
  status public.guest_request_status not null default 'PENDING',
  priority public.guest_request_priority not null default 'MEDIUM',
  assigned_to text,
  created_by text,
  requested_at timestamptz default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists guest_requests_request_number_key
  on guest_requests (request_number)
  where request_number is not null and trim(request_number) <> '';

-- assigned_to / created_by store hk_staff.id or display name (no users FK)

create or replace function public.guest_requests_assign_request_number()
returns trigger language plpgsql as $$
begin
  if new.request_number is null or trim(new.request_number) = '' then
    new.request_number := 'GR-' || nextval('public.guest_requests_request_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guest_requests_assign_request_number on guest_requests;
create trigger trg_guest_requests_assign_request_number
  before insert on guest_requests for each row
  execute function public.guest_requests_assign_request_number();

create or replace function public.guest_requests_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_guest_requests_set_updated_at on guest_requests;
create trigger trg_guest_requests_set_updated_at
  before update on guest_requests for each row
  execute function public.guest_requests_set_updated_at();

-- ========== MAINTENANCE REQUESTS ==========
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
  public_area_id text references public_areas(id) on delete set null,
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

-- ========== PUBLIC AREAS MASTER (inventory) ==========
do $$
begin
  create type public.public_area_priority as enum (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public_areas (
  id text primary key default gen_random_uuid()::text,
  area_code text not null unique,
  name text not null,
  area_type text not null default 'Lobby',
  location text,
  floor_number int,
  priority public.public_area_priority not null default 'MEDIUM',
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.public_areas_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_public_areas_set_updated_at on public_areas;
create trigger trg_public_areas_set_updated_at
  before update on public_areas for each row
  execute function public.public_areas_set_updated_at();

-- ========== PUBLIC AREAS OPS (legacy hk_public_areas) ==========
create table if not exists hk_public_areas (
  id text primary key,
  name text not null,
  category text not null default 'Lobby',
  floor text default '',
  location text default '',
  assigned_staff text default '',
  supervisor text default '',
  cleaning_frequency text default 'Daily',
  status text not null default 'Dirty',
  priority text not null default 'Medium',
  last_cleaned text default '',
  next_cleaning text default '',
  est_duration text default '',
  inspection_status text default 'None',
  checklist jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ========== CHECKLISTS ==========
create table if not exists hk_checklist_templates (
  id text primary key,
  name text not null,
  type text not null default 'Stay-over',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ========== STAFF & SHIFTS ==========
create table if not exists hk_staff (
  id text primary key,
  name text not null,
  role text not null default 'Housekeeper',
  active_shift text default '',
  phone text default '',
  status text not null default 'Active',
  active_task_count int default 0,
  completed_today int default 0,
  current_floor text,
  last_assigned_time text,
  work_status text default 'Available',
  active_jobs int default 0,
  last_assignment text,
  specialization text,
  created_at timestamptz default now()
);

create table if not exists hk_shifts (
  id text primary key,
  name text not null,
  timings text not null default '',
  description text default '',
  created_at timestamptz default now()
);

-- ========== INVENTORY ==========
create table if not exists hk_inventory (
  id text primary key,
  name text not null,
  category text not null default 'Amenity',
  available numeric not null default 0,
  laundry numeric default 0,
  damaged numeric not null default 0,
  lost numeric not null default 0,
  discarded numeric not null default 0,
  par_stock numeric not null default 0,
  unit text not null default 'Pcs',
  created_at timestamptz default now()
);

-- ========== LAUNDRY ==========
create table if not exists hk_laundry_jobs (
  id text primary key,
  type text not null default 'Guest',
  item text not null,
  quantity numeric not null default 1,
  room text,
  guest_name text,
  status text not null default 'Collection',
  charges numeric not null default 0,
  timeline jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz default now()
);

-- ========== DAMAGE ==========
-- Legacy hk_damage_reports — run sql/damage-reports.sql for slim damage_reports table
create table if not exists hk_damage_reports (
  id text primary key,
  room text not null,
  damage_type text not null default 'Other',
  description text not null default '',
  photo text,
  reported_by text default '',
  reported_at text default '',
  estimated_cost numeric not null default 0,
  status text not null default 'Reported',
  created_at timestamptz default now()
);

-- ========== REQUISITIONS ==========
create table if not exists hk_requisitions (
  id text primary key,
  request_no text not null,
  requested_by text not null default '',
  items jsonb not null default '[]'::jsonb,
  status text not null default 'Pending',
  requested_at text default '',
  issued_at text,
  remarks text,
  created_at timestamptz default now()
);

-- ========== HISTORY ==========
create table if not exists hk_history (
  id text primary key,
  timestamp text not null default '',
  "user" text not null default '',
  category text not null default 'Cleaning',
  action text not null default '',
  room text,
  details text default '',
  created_at timestamptz default now()
);

-- ========== LUGGAGE (HK ops) ==========
create table if not exists hk_luggage_jobs (
  id text primary key,
  guest text not null default '',
  room text default '',
  bell_boy text default '',
  tag_number text default '',
  bag_count int not null default 1,
  type text not null default 'Check-in',
  pickup_time text default '',
  delivery_time text,
  status text not null default 'Pending',
  remarks text,
  created_at timestamptz default now()
);

-- ========== SETTINGS ==========
create table if not exists hk_settings (
  id text primary key,
  label text,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ========== SEED: ROOMS ==========
create extension if not exists pgcrypto;

insert into hk_rooms (room_id, status, notes, last_cleaned_at)
select r.id, v.status::public.hk_room_status, v.notes, v.last_cleaned_at
from (values
  ('101', 'DIRTY', 'Needs standard check-out cleaning.', null),
  ('102', 'INSPECTED', null, null),
  ('103', 'DIRTY', null, null),
  ('104', 'OUT_OF_SERVICE', 'AC not cooling. Placed OOO.', null),
  ('105', 'OUT_OF_SERVICE', 'Blocked for upcoming group reservation.', null),
  ('112', 'CLEAN', null, null),
  ('204', 'INSPECTING', 'Awaiting supervisor verification.', now() - interval '2 hours'),
  ('305', 'DIRTY', 'Stay-over clean due.', null),
  ('308', 'INSPECTED', null, null),
  ('501', 'CLEAN', null, null),
  ('602', 'INSPECTED', null, null)
) as v(room_no, status, notes, last_cleaned_at)
join rooms r on r.room_no = v.room_no
on conflict (room_id) do nothing;

-- ========== SEED: PUBLIC AREAS MASTER ==========
insert into public_areas (area_code, name, area_type, location, floor_number, priority, is_active)
values
  ('PA-LOBBY', 'Main Lobby & Reception', 'Lobby', 'Main Entrance Lobby', 0, 'HIGH', true),
  ('PA-REST', 'Restaurant Dining Area', 'Restaurant', 'Saffron Spice Restaurant', 0, 'HIGH', true),
  ('PA-WC', 'Lobby Washrooms', 'Washroom', 'Lobby Restroom Corridor', 0, 'URGENT', true)
on conflict (area_code) do nothing;

-- ========== SEED: PUBLIC AREAS OPS (sample) ==========
insert into hk_public_areas (id, name, category, floor, location, assigned_staff, supervisor, cleaning_frequency, status, priority, last_cleaned, next_cleaning, est_duration, inspection_status, checklist, history)
values
  ('PA-01', 'Main Lobby & Reception', 'Lobby', 'Ground Floor', 'Main Entrance Lobby', 'Ravi Shankar', 'Ramesh Kumar', 'Every 2 Hours', 'Inspected', 'High', '16 Jul 11:00 AM', '16 Jul 01:00 PM', '30 mins', 'Passed',
   '[{"task":"Sweep, vacuum, and mop floor surfaces","completed":true},{"task":"Wipe and sanitize reception desk/counters","completed":true}]'::jsonb,
   '[{"id":"HPA-001","date":"16 Jul 11:00 AM","housekeeper":"Ravi Shankar","supervisor":"Ramesh Kumar","duration":"25 mins","status":"Inspected","remarks":"Lobby clean"}]'::jsonb),
  ('PA-02', 'Restaurant Dining Area', 'Restaurant', 'Ground Floor', 'Saffron Spice Restaurant', 'Meena Kumari', 'Ramesh Kumar', 'After Every Meal Service', 'Dirty', 'High', '16 Jul 09:30 AM', '16 Jul 02:30 PM', '45 mins', 'None',
   '[{"task":"Tables Sanitized","completed":false},{"task":"Floor Mopped","completed":false}]'::jsonb,
   '[]'::jsonb),
  ('PA-08', 'Lobby Washrooms', 'Washroom', 'Ground Floor', 'Lobby Restroom Corridor', 'Meena Kumari', 'Ramesh Kumar', 'Every 1 Hour', 'Dirty', 'High', '16 Jul 02:00 PM', '16 Jul 03:00 PM', '20 mins', 'None',
   '[{"task":"Toilets Sanitized & Disinfected","completed":false},{"task":"Mirrors Wiped & Polished","completed":false}]'::jsonb,
   '[]'::jsonb)
on conflict (id) do nothing;

-- ========== SEED: CHECKLISTS ==========
insert into hk_checklist_templates (id, name, type, items) values
  ('CL-01', 'Stay-over Room Checklist', 'Stay-over', '["Make bed and fluff pillows","Empty trash bins and replace liners","Wipe down bedside tables and desk","Restock amenities","Clean bathroom sink, mirror, and toilet","Replace used towels","Sweep and mop floor"]'::jsonb),
  ('CL-02', 'Departure Room Checklist', 'Departure', '["Strip all bed linens","Check drawers for lost & found","Disinfect high-touch surfaces","Deep clean bathroom","Replace all linen","Restock amenities","Vacuum and mop","Inspect fixtures"]'::jsonb),
  ('CL-03', 'Deep Cleaning Checklist', 'Deep-Clean', '["Wash mattress protector","Steam clean carpets","Deep wash balcony","Clean behind furniture","Inspect HVAC vents","Polish wooden furniture"]'::jsonb),
  ('CL-04', 'Public Area Checklist', 'Public-Area', '["Sweep, vacuum, and mop","Wipe counters","Clean glass panels","Empty trash bins","Wipe lift buttons","Inspect lighting"]'::jsonb)
on conflict (id) do nothing;

-- ========== SEED: STAFF ==========
insert into hk_staff (id, name, role, active_shift, phone, status, active_task_count, completed_today, current_floor, work_status, specialization) values
  ('ST-01', 'Meena Kumari', 'Housekeeper', 'Morning Shift', '+91 99001 12233', 'Active', 2, 4, '2nd Floor', 'Available', null),
  ('ST-02', 'Ravi Shankar', 'Housekeeper', 'Morning Shift', '+91 99002 23344', 'Active', 1, 5, '1st Floor', 'Available', null),
  ('ST-03', 'Kiran Bala', 'Housekeeper', 'Afternoon Shift', '+91 99003 34455', 'Active', 0, 2, '3rd Floor', 'Available', null),
  ('ST-04', 'Ramesh Kumar', 'Supervisor', 'Morning Shift', '+91 99004 45566', 'Active', 0, 0, null, 'Available', null),
  ('ST-05', 'Suresh Gupta', 'Engineer', 'Morning Shift', '+91 99005 56677', 'Active', 0, 3, '1st Floor', 'Available', 'HVAC'),
  ('ST-07', 'Vikram Singh', 'Bell Boy', 'General Shift', '+91 99007 78899', 'Active', 0, 0, null, 'Available', null),
  ('ST-08', 'Somnath Sen', 'Laundry Staff', 'General Shift', '+91 99008 89900', 'Active', 0, 0, null, 'Available', null)
on conflict (id) do nothing;

-- ========== SEED: SHIFTS ==========
insert into hk_shifts (id, name, timings, description) values
  ('SH-01', 'Morning Shift', '07:00 AM - 03:00 PM', 'Primary shift for checkout room cleanings and daily services.'),
  ('SH-02', 'Afternoon Shift', '03:00 PM - 11:00 PM', 'Turn-down service, guest requests, and evening corridor checkups.'),
  ('SH-03', 'Night Shift', '11:00 PM - 07:00 AM', 'Emergency cleaning, lobby deep cleaning, laundry sorting.'),
  ('SH-04', 'General Shift', '09:00 AM - 05:00 PM', 'Stores control, linen laundry operations, administration.')
on conflict (id) do nothing;

-- ========== SEED: INVENTORY ==========
insert into hk_inventory (id, name, category, available, laundry, damaged, lost, discarded, par_stock, unit) values
  ('INV-L01', 'King Bed Sheets', 'Linen', 120, 45, 6, 2, 12, 150, 'Pcs'),
  ('INV-L02', 'Pillow Covers', 'Linen', 250, 80, 10, 4, 20, 300, 'Pcs'),
  ('INV-L03', 'Bath Towels', 'Linen', 180, 60, 8, 3, 15, 200, 'Pcs'),
  ('INV-A01', 'Luxury Herbal Soap (20g)', 'Amenity', 450, 0, 0, 0, 0, 500, 'Pcs'),
  ('INV-A02', 'Moisturizing Shampoo (40ml)', 'Amenity', 380, 0, 0, 0, 0, 500, 'Pcs'),
  ('INV-A05', 'Hotel Slippers (Disposable)', 'Amenity', 85, 0, 0, 2, 0, 150, 'Pairs'),
  ('INV-C01', 'R1 Floor Cleaner (Concentrate)', 'Chemical', 45, 0, 1, 0, 0, 50, 'Liters'),
  ('INV-E01', 'Taski Vacuum Cleaners', 'Equipment', 6, 0, 1, 0, 0, 6, 'Pcs')
on conflict (id) do nothing;

-- ========== SEED: LAUNDRY ==========
insert into hk_laundry_jobs (id, type, item, quantity, room, guest_name, status, charges, timeline, notes) values
  ('LD-01', 'Guest', 'Silk Shirt & Trousers', 2, '112', 'James Wilson', 'Washing', 350, '{"collectedAt":"23 Jun 08:30 AM"}'::jsonb, 'Soft wash. Ironing required.'),
  ('LD-02', 'Hotel', 'Bath Towels (Dirty batch)', 45, null, null, 'Ironing', 450, '{"collectedAt":"23 Jun 07:15 AM","washedAt":"23 Jun 09:30 AM"}'::jsonb, null),
  ('LD-03', 'Hotel', 'King Bed Sheets (Dirty batch)', 30, null, null, 'Ready', 600, '{"collectedAt":"22 Jun 04:00 PM","washedAt":"22 Jun 06:30 PM","readyAt":"23 Jun 10:00 AM"}'::jsonb, null),
  ('LD-04', 'Guest', 'Cotton Dress', 1, '204', 'Rahul Sharma', 'Delivered', 180, '{"collectedAt":"22 Jun 09:00 AM","washedAt":"22 Jun 11:30 AM","readyAt":"22 Jun 03:00 PM","deliveredAt":"22 Jun 04:30 PM"}'::jsonb, null)
on conflict (id) do nothing;

-- ========== SEED: DAMAGE / REQUISITIONS / HISTORY / LUGGAGE ==========
insert into hk_damage_reports (id, room, damage_type, description, reported_by, reported_at, estimated_cost, status) values
  ('DM-01', '305', 'Furniture', 'Bed side table drawer handle broken.', 'Meena (Housekeeper)', '23 Jun 08:45 AM', 450, 'Reported'),
  ('DM-02', '104', 'AC', 'Compressor failure causing no cooling.', 'Ramesh (Supervisor)', '23 Jun 07:10 AM', 4500, 'Approved')
on conflict (id) do nothing;

insert into hk_requisitions (id, request_no, requested_by, items, status, requested_at, issued_at, remarks) values
  ('RQ-01', 'REQ-2026-004', 'Meena Kumari', '[{"item":"Luxury Herbal Soap (20g)","quantity":50,"unit":"Pcs"},{"item":"Moisturizing Shampoo (40ml)","quantity":50,"unit":"Pcs"}]'::jsonb, 'Approved', '23 Jun 08:00 AM', '23 Jun 08:30 AM', 'Issued for 2nd Floor cart.'),
  ('RQ-02', 'REQ-2026-005', 'Ravi Shankar', '[{"item":"King Bed Sheets","quantity":15,"unit":"Pcs"},{"item":"Bath Towels","quantity":20,"unit":"Pcs"}]'::jsonb, 'Pending', '23 Jun 11:45 AM', null, 'Awaiting store manager approval.')
on conflict (id) do nothing;

insert into hk_history (id, timestamp, "user", category, action, room, details) values
  ('H-01', '23 Jun 11:30 AM', 'Meena Kumari', 'Cleaning', 'Finished Cleaning', '204', 'Completed Stay-over cleaning. Marked Awaiting Inspection.'),
  ('H-02', '23 Jun 10:00 AM', 'Ramesh Kumar', 'Inspection', 'Inspection Passed', '103', 'Room passed supervisor inspection. Vacant Ready.'),
  ('H-03', '23 Jun 09:15 AM', 'System', 'Room Status', 'Checkout Dirty Triggered', '101', 'FO checkout marked room 101 Vacant Dirty.'),
  ('H-04', '23 Jun 08:30 AM', 'Somnath Sen', 'Inventory', 'Linen Restocked', null, 'Issued 50 pillow covers and 30 sheets to 3rd Floor store.')
on conflict (id) do nothing;

insert into hk_luggage_jobs (id, guest, room, bell_boy, tag_number, bag_count, type, pickup_time, delivery_time, status, remarks) values
  ('LG-001', 'James Wilson', '112', 'Vikram Singh', 'TAG-9921', 3, 'Check-in', '22 Jun 02:15 PM', '22 Jun 02:30 PM', 'Delivered', 'Delivered to room safely.'),
  ('LG-002', 'Priya Patel', '501', 'Vikram Singh', 'TAG-9922', 4, 'Storage', '23 Jun 11:00 AM', null, 'Stored', 'Stored in Locker A-15.')
on conflict (id) do nothing;

insert into hk_settings (id, label, value) values
  ('general', 'General HK Settings', '{"autoMarkDirtyOnCheckout":true,"inspectionRequired":true,"defaultCleanMinutes":30}'::jsonb)
on conflict (id) do nothing;

-- ========== RLS (anon access — same pattern as FO / F&B) ==========
do $$
declare
  t text;
begin
  foreach t in array array[
    'hk_rooms','housekeeping_tasks','guest_requests','maintenance_requests','public_areas','hk_public_areas','hk_checklist_templates','hk_staff','hk_shifts',
    'hk_inventory','hk_laundry_jobs','hk_damage_reports','hk_requisitions',
    'hk_history','hk_luggage_jobs','hk_settings'
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

notify pgrst, 'reload schema';

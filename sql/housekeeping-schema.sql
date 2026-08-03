-- Housekeeping schema for Hotel PMS
-- Run in Supabase SQL Editor after front-office-schema.sql
-- Shared FO tables (housekeeping_requests, maintenance_requests, luggage_items,
-- lost_found_items) are reused via /api/housekeeping/guest-requests|maintenance|lost-found

-- ========== ROOMS ==========
create table if not exists hk_rooms (
  id text primary key,
  room_no text not null unique,
  category text not null default 'Standard',
  type text,
  bed_type text default 'King',
  floor text not null default '',
  wing text default '',
  max_occupancy int not null default 2,
  cleaning_frequency text default 'Daily',
  deep_cleaning_frequency text default 'Every 30 Days',
  last_deep_cleaned text default '',
  status text not null default 'Vacant Dirty',
  hk_status text not null default 'Dirty',
  fo_status text not null default 'Vacant',
  dnd boolean not null default false,
  sleep_out boolean not null default false,
  facilities jsonb not null default '[]'::jsonb,
  remarks text default '',
  assigned_staff text,
  assigned_supervisor text,
  cleaning_timer jsonb,
  cleaning_progress int default 0,
  photos jsonb not null default '[]'::jsonb,
  inspection_history jsonb not null default '[]'::jsonb,
  guest_name text,
  checkout_date text,
  housekeeping text,
  maintenance text default 'OK',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ========== PUBLIC AREAS ==========
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
insert into hk_rooms (id, room_no, category, type, bed_type, floor, wing, max_occupancy, cleaning_frequency, deep_cleaning_frequency, last_deep_cleaned, status, hk_status, fo_status, dnd, sleep_out, facilities, remarks, guest_name, checkout_date, maintenance, assigned_staff, assigned_supervisor, cleaning_progress, photos, inspection_history)
values
  ('101', '101', 'Standard', 'Standard', 'King', '1st Floor', 'East Wing', 2, 'Daily', 'Every 30 Days', '10 Jun 2026', 'Occupied', 'Clean', 'Occupied', false, false, '["WiFi","TV","Safe"]'::jsonb, 'Needs standard check-out cleaning.', 'James Wilson', '27 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('102', '102', 'Standard', 'Standard', 'Twin', '1st Floor', 'East Wing', 2, 'Daily', 'Every 30 Days', '12 Jun 2026', 'Vacant Ready', 'Clean', 'Vacant', false, false, '["WiFi","TV","Safe"]'::jsonb, '', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('103', '103', 'Standard', 'Standard', 'King', '1st Floor', 'East Wing', 2, 'Daily', 'Every 30 Days', '15 Jun 2026', 'Vacant Dirty', 'Dirty', 'Vacant', false, false, '["WiFi","TV","Safe"]'::jsonb, '', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('104', '104', 'Standard', 'Standard', 'King', '1st Floor', 'West Wing', 2, 'Daily', 'Every 30 Days', '05 Jun 2026', 'Out of Order', 'OOO', 'Blocked', false, false, '["WiFi","TV","Safe"]'::jsonb, 'AC not cooling. Placed OOO.', null, null, 'In Progress', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('105', '105', 'Standard', 'Standard', 'Twin', '1st Floor', 'West Wing', 2, 'Daily', 'Every 30 Days', '08 Jun 2026', 'Blocked', 'Clean', 'Blocked', false, false, '["WiFi","TV","Safe"]'::jsonb, 'Blocked for upcoming group reservation.', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('201', '201', 'Deluxe', 'Deluxe', 'King', '2nd Floor', 'East Wing', 3, 'Daily', 'Every 60 Days', '28 May 2026', 'Occupied Dirty', 'Dirty', 'Occupied', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, 'VIP guest. Stay-over clean.', 'Sarah Chen', '28 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('202', '202', 'Deluxe', 'Deluxe', 'Queen', '2nd Floor', 'East Wing', 2, 'Daily', 'Every 60 Days', '01 Jun 2026', 'Occupied', 'Clean', 'Occupied', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, '', 'Meghna Nair', '29 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('203', '203', 'Deluxe', 'Deluxe', 'King', '2nd Floor', 'West Wing', 3, 'Daily', 'Every 60 Days', '02 Jun 2026', 'Cleaning', 'Cleaning', 'Vacant', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, 'Cleaning in progress by Housekeeper Meena.', null, null, 'OK', 'Meena', null, 45, '[]'::jsonb, '[]'::jsonb),
  ('204', '204', 'Deluxe', 'Deluxe', 'King', '2nd Floor', 'West Wing', 3, 'Daily', 'Every 60 Days', '03 Jun 2026', 'Inspection Pending', 'Cleaning', 'Vacant', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, 'Awaiting Supervisor verification.', 'Rahul Sharma', '26 Jun', 'OK', 'Meena', 'Ramesh', 100, '["/sample-bathroom.jpg"]'::jsonb, '[{"id":"INS-99210","date":"15 Jul 2026","time":"09:30 AM","inspector":"Ramesh Kumar","supervisor":"Ramesh Kumar","result":"Rejected","qualityScore":78,"remarks":"Bathroom mirror had smudges.","signature":"Ramesh Kumar"}]'::jsonb),
  ('301', '301', 'Executive Suite', 'Executive Suite', 'King', '3rd Floor', 'East Wing', 4, 'Daily', 'Every 90 Days', '10 May 2026', 'Occupied', 'Clean', 'Occupied', false, true, '["WiFi","TV","Safe","Mini Bar","Bathtub","Balcony"]'::jsonb, 'Guest noted as Sleep Out.', 'John Doe', '30 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('302', '302', 'Executive Suite', 'Executive Suite', 'King', '3rd Floor', 'East Wing', 4, 'Daily', 'Every 90 Days', '15 May 2026', 'Out of Service', 'OOS', 'Vacant', false, false, '["WiFi","TV","Safe","Mini Bar","Bathtub","Balcony"]'::jsonb, 'Balcony door lock minor issue.', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('305', '305', 'Deluxe', 'Deluxe', 'King', '3rd Floor', 'West Wing', 3, 'Daily', 'Every 60 Days', '20 May 2026', 'Occupied Dirty', 'Dirty', 'Occupied', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, 'Stay-over clean due.', 'Michael Brown', '24 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('412', '412', 'Standard', 'Standard', 'King', '4th Floor', 'East Wing', 2, 'Daily', 'Every 30 Days', '14 Jun 2026', 'Vacant Ready', 'Clean', 'Vacant', false, false, '["WiFi","TV","Safe"]'::jsonb, '', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('501', '501', 'Suite', 'Suite', 'King', '5th Floor', 'East Wing', 4, 'Daily', 'Every 90 Days', '18 May 2026', 'Occupied', 'Clean', 'Occupied', false, false, '["WiFi","TV","Safe","Mini Bar","Bathtub"]'::jsonb, '', 'Priya Patel', '27 Jun', 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb),
  ('602', '602', 'Suite', 'Suite', 'King', '6th Floor', 'East Wing', 4, 'Daily', 'Every 90 Days', '22 May 2026', 'Vacant Ready', 'Inspected', 'Vacant', false, false, '["WiFi","TV","Safe","Mini Bar"]'::jsonb, '', null, null, 'OK', null, null, 0, '[]'::jsonb, '[]'::jsonb)
on conflict (id) do nothing;

-- ========== SEED: PUBLIC AREAS (sample) ==========
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

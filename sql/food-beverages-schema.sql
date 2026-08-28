-- Food & Beverages schema for Hotel PMS
-- Run in Supabase SQL Editor after front-office-schema.sql

create extension if not exists pgcrypto;

-- ========== CORE ==========
create table if not exists fb_outlets (
  id text primary key,
  name text not null,
  type text not null,
  status text not null default 'Active',
  booking_status text not null default 'Available',
  tables int default 0,
  covers int default 0,
  sales text default '₹0',
  created_at timestamptz default now()
);

create table if not exists fb_live_tables (
  id text primary key,
  outlet_id text not null references fb_outlets(id) on delete cascade,
  table_no text not null,
  section text not null default '',
  capacity int not null default 2,
  covers int not null default 0,
  guest text default '—',
  server text default '—',
  duration_min int not null default 0,
  check_amount numeric not null default 0,
  status text not null default 'Available',
  shape text default 'Square',
  qr text default 'Linked',
  created_at timestamptz default now()
);

create table if not exists fb_orders (
  id text primary key,
  order_no text not null unique,
  outlet_id text not null references fb_outlets(id) on delete cascade,
  type text not null default 'Dine In',
  ref text default '',
  guest text default '',
  lines jsonb not null default '[]'::jsonb,
  amount numeric not null default 0,
  status text not null default 'Pending',
  placed_at text default '',
  server text default '',
  prep_minutes int,
  reject_reason text,
  payment_mode text,
  paid_at text,
  cashier_shift_id text,
  created_at timestamptz default now()
);

create table if not exists fb_kds_tickets (
  id text primary key,
  ticket text not null,
  outlet_id text not null references fb_outlets(id) on delete cascade,
  station text not null default 'Hot',
  table_ref text default '',
  order_no text default '',
  lines jsonb not null default '[]'::jsonb,
  elapsed_min int not null default 0,
  sla_min int not null default 15,
  status text not null default 'Pending',
  priority text not null default 'Normal',
  created_at timestamptz default now()
);

create table if not exists fb_cashier_shifts (
  id text primary key,
  outlet_id text not null references fb_outlets(id) on delete cascade,
  cashier text not null,
  shift text not null,
  opened_at text not null,
  opening_float numeric not null default 0,
  cash_sales numeric not null default 0,
  card_sales numeric not null default 0,
  upi_sales numeric not null default 0,
  refunds numeric not null default 0,
  declared_cash numeric,
  status text not null default 'Open',
  created_at timestamptz default now()
);

create table if not exists fb_reservations (
  id text primary key,
  res_no text not null,
  outlet_id text,
  guest text not null,
  phone text default '',
  time text default '',
  covers int default 2,
  table_no text default '',
  status text not null default 'Confirmed',
  created_at timestamptz default now()
);

-- ========== MASTERS ==========
create table if not exists fnb_units (
  id uuid primary key default gen_random_uuid(),
  code varchar unique not null,
  name varchar not null,
  symbol varchar default '',
  unit_type varchar default 'Count',
  decimal_places integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fnb_tax_groups (
  id uuid primary key default gen_random_uuid(),
  code varchar unique not null,
  name varchar not null,
  description text default '',
  tax_codes text default '',
  total_rate numeric default 0,
  applies_to varchar default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

-- ========== MENU ==========
create table if not exists fnb_menu_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  code varchar unique,
  description text,
  parent_id uuid references fnb_menu_categories (id) on delete set null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fnb_menu_categories_parent on fnb_menu_categories (parent_id);
create index if not exists idx_fnb_menu_categories_display_order on fnb_menu_categories (display_order);

do $$
begin
  create type fnb_item_type as enum ('FOOD', 'BEVERAGE', 'ALCOHOL', 'SERVICE', 'OTHER');
exception
  when duplicate_object then null;
end $$;

create table if not exists fnb_menu_items (
  id uuid primary key default gen_random_uuid(),
  item_code varchar unique not null,
  name varchar not null,
  description text,
  category_id uuid not null references fnb_menu_categories (id) on delete restrict,
  unit_id uuid references fnb_units (id) on delete set null,
  tax_group_id uuid references fnb_tax_groups (id) on delete set null,
  item_type fnb_item_type not null default 'FOOD',
  is_vegetarian boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fnb_menu_items_category on fnb_menu_items (category_id);

create table if not exists fb_modifiers (
  id text primary key,
  code text,
  name text not null,
  group_name text default '',
  price numeric default 0,
  linked_items text default '',
  status text default 'Active',
  created_at timestamptz default now()
);

-- ========== INVENTORY ==========
create table if not exists fb_ingredients (
  id text primary key,
  code text,
  name text not null,
  uom text default 'kg',
  on_hand numeric default 0,
  reorder numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_wastage (
  id text primary key,
  entry_no text,
  type text default '',
  item text default '',
  qty numeric default 0,
  value numeric default 0,
  reason text default '',
  status text default 'Posted',
  created_at timestamptz default now()
);

create table if not exists fb_stock_adjustments (
  id text primary key,
  adj_no text,
  item text default '',
  qty numeric default 0,
  reason text default '',
  value numeric default 0,
  status text default 'Posted',
  created_at timestamptz default now()
);

create table if not exists fb_day_closings (
  id text primary key,
  outlet_id text,
  business_date text,
  checkpoint text,
  detail text default '',
  count int default 0,
  status text default 'Pending',
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_fb_live_tables_outlet on fb_live_tables(outlet_id);
create index if not exists idx_fb_orders_outlet on fb_orders(outlet_id);
create index if not exists idx_fb_orders_status on fb_orders(status);
create index if not exists idx_fb_kds_outlet on fb_kds_tickets(outlet_id);
create index if not exists idx_fb_cashier_outlet on fb_cashier_shifts(outlet_id);

-- RLS
do $$
declare
  t text;
begin
  foreach t in array array[
    'fb_outlets','fb_live_tables','fb_orders','fb_kds_tickets','fb_cashier_shifts',
    'fb_reservations','fnb_units','fnb_tax_groups','fb_modifier_groups','fb_outlet_types',
    'fnb_menu_categories','fnb_menu_items','fb_modifiers',
    'fb_ingredients','fb_wastage','fb_stock_adjustments',
    'fb_day_closings'
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

-- ========== SEED OUTLETS ==========
insert into fb_outlets (id, name, type, status, tables, covers, sales) values
  ('rest-1','Restaurant #1','restaurant','Active',16,72,'₹48,620'),
  ('rest-2','Restaurant #2','restaurant','Active',12,54,'₹31,200'),
  ('cafe-1','Lobby Cafe','cafe','Active',10,38,'₹14,800'),
  ('cafe-2','Pool Cafe','cafe','Active',10,22,'₹9,400'),
  ('main-kitchen','Main Kitchen','kitchen','Active',0,0,'₹0'),
  ('indian-kitchen','Indian Kitchen','kitchen','Active',0,0,'₹0'),
  ('continental-kitchen','Continental Kitchen','kitchen','Active',0,0,'₹0'),
  ('italian-kitchen','Italian Kitchen','kitchen','Active',0,0,'₹0'),
  ('main-bar','Main Bar','bar','Active',0,0,'₹0'),
  ('lobby-bar','Lobby Bar','bar','Active',0,0,'₹0')
on conflict (id) do nothing;

insert into fb_live_tables (id, outlet_id, table_no, section, capacity, covers, guest, server, duration_min, check_amount, status, shape, qr) values
  ('L1','rest-1','T-01','Garden',2,0,'—','—',0,0,'Available','Round','Linked'),
  ('L2','rest-1','T-02','Garden',4,3,'Rahul Sharma','Meena',32,3120,'Occupied','Square','Linked'),
  ('L3','rest-1','T-03','Garden',4,0,'—','—',0,0,'Dirty','Square','Linked'),
  ('L4','rest-1','T-04','Indoor',4,4,'Priya Patel','Amit',48,2180,'Occupied','Square','Linked'),
  ('L5','rest-1','T-05','Indoor',2,0,'—','—',0,0,'Available','Round','Linked'),
  ('L6','rest-1','T-06','Indoor',6,0,'—','—',0,0,'Available','Rectangle','Linked'),
  ('L7','rest-1','T-07','Indoor',6,6,'Corporate','—',0,0,'Reserved','Rectangle','Pending'),
  ('L8','rest-1','T-08','Window',2,0,'—','—',0,0,'Available','Round','Linked'),
  ('L9','rest-1','T-09','Window',2,0,'—','—',0,0,'Available','Round','Linked'),
  ('L10','rest-1','T-10','Window',4,0,'—','—',0,0,'Available','Square','Linked'),
  ('L11','rest-1','T-11','Window',4,2,'Walk-in','Neha',15,680,'Occupied','Square','Linked'),
  ('L12','rest-1','T-12','Window',2,2,'James Wilson','Neha',65,1840,'Billing','Round','Linked'),
  ('L13','rest-2','T-01','Main',4,0,'—','—',0,0,'Available','Square','Linked'),
  ('L14','rest-2','T-02','Main',4,2,'Anita Desai','Ravi',22,940,'Occupied','Square','Linked'),
  ('L15','rest-2','T-03','Main',8,5,'Group','Ravi',40,4560,'Occupied','Rectangle','Linked'),
  ('L16','rest-2','T-04','Patio',2,0,'—','—',0,0,'Reserved','Round','Linked')
on conflict (id) do nothing;

insert into fb_orders (id, order_no, outlet_id, type, ref, guest, lines, amount, status, placed_at, server) values
  ('OR1','ORD-501','rest-1','Dine In','T-04','Priya Patel','[{"name":"Butter Chicken","qty":2},{"name":"Garlic Naan","qty":3},{"name":"Dal Makhani","qty":1}]',2180,'Preparing','1:12 PM','Amit'),
  ('OR2','ORD-502','rest-1','Room Service','Room 501','Priya Patel','[{"name":"Club Sandwich","qty":1},{"name":"Fresh Lime Soda","qty":2}]',1240,'Ready','1:18 PM','Room Service'),
  ('OR3','ORD-503','rest-1','Takeaway','Counter','Walk-in','[{"name":"Paneer Tikka","qty":1},{"name":"Roti","qty":2}]',480,'Pending','1:25 PM','Counter'),
  ('OR4','ORD-504','rest-2','Online','Zomato','Rahul S.','[{"name":"Chicken Biryani","qty":2},{"name":"Raita","qty":2}]',920,'Preparing','1:22 PM','Online'),
  ('OR5','ORD-505','rest-1','Dine In','T-02','Rahul Sharma','[{"name":"Thali","qty":3},{"name":"Sweet Lassi","qty":3}]',3120,'Served','12:40 PM','Meena'),
  ('OR6','ORD-506','rest-1','Dine In','T-12','James Wilson','[{"name":"Steak","qty":1},{"name":"Salad","qty":1}]',1840,'Served','12:05 PM','Neha'),
  ('OR7','ORD-507','rest-1','Room Service','Room 305','Michael Brown','[{"name":"Continental Breakfast","qty":1}]',650,'Pending','1:30 PM','Room Service')
on conflict (id) do nothing;

insert into fb_kds_tickets (id, ticket, outlet_id, station, table_ref, order_no, lines, elapsed_min, sla_min, status, priority) values
  ('K1','KDS-88','indian-kitchen','Hot','T-04','ORD-501','[{"name":"Butter Chicken","qty":2},{"name":"Dal Makhani","qty":1}]',8,15,'Preparing','Normal'),
  ('K2','KDS-89','indian-kitchen','Tandoor','T-02','ORD-505','[{"name":"Paneer Tikka","qty":1,"note":"Extra spice"}]',4,12,'Pending','Normal'),
  ('K3','KDS-90','main-kitchen','Pastry','T-12','ORD-506','[{"name":"Gulab Jamun","qty":2}]',12,10,'Ready','Normal'),
  ('K4','KDS-91','continental-kitchen','Grill','T-03','ORD-508','[{"name":"Steak Medium","qty":1,"note":"No sauce"}]',16,18,'Preparing','High'),
  ('K5','KDS-92','main-kitchen','Hot','Room 501','ORD-502','[{"name":"Club Sandwich","qty":1}]',6,12,'Ready','High'),
  ('K6','KDS-93','indian-kitchen','Tandoor','Counter','ORD-503','[{"name":"Paneer Tikka","qty":1}]',2,12,'Pending','Normal'),
  ('K7','KDS-94','indian-kitchen','Hot','Online','ORD-504','[{"name":"Chicken Biryani","qty":2},{"name":"Raita","qty":2}]',9,20,'Preparing','Normal')
on conflict (id) do nothing;

insert into fb_cashier_shifts (id, outlet_id, cashier, shift, opened_at, opening_float, cash_sales, card_sales, upi_sales, refunds, declared_cash, status) values
  ('C1','rest-1','Amit Kumar','Lunch','11:00 AM',2000,8200,12400,7800,200,null,'Open'),
  ('C2','rest-2','Ravi Singh','Lunch','11:00 AM',1500,4100,6200,2800,0,null,'Open'),
  ('C3','rest-1','Neha Singh','Breakfast','7:00 AM',1500,3200,5400,2100,150,4850,'Closed')
on conflict (id) do nothing;

insert into fnb_units (id, code, name, symbol, unit_type, decimal_places, is_active) values
  ('b2000001-0000-4000-8000-000000000001', 'KG', 'Kilogram', 'kg', 'Weight', 2, true),
  ('b2000001-0000-4000-8000-000000000002', 'LTR', 'Litre', 'L', 'Volume', 2, true),
  ('b2000001-0000-4000-8000-000000000003', 'PCS', 'Pieces', 'pcs', 'Count', 0, true)
on conflict (id) do nothing;

insert into fnb_tax_groups (id, code, name, tax_codes, total_rate, applies_to, is_active) values
  ('c2000001-0000-4000-8000-000000000001', 'TG-FOOD5', 'Food GST 5%', 'CGST2.5,SGST2.5', 5, 'Food', true),
  ('c2000001-0000-4000-8000-000000000002', 'TG-LIQ18', 'Liquor GST 18%', 'CGST9,SGST9', 18, 'Liquor', true)
on conflict (id) do nothing;

insert into fb_modifier_groups (id, code, name, options_count, min_select, max_select, is_required, status) values
  ('MG1', 'MG-SPICE', 'Spice Level', 4, 1, 1, true, 'Active'),
  ('MG2', 'MG-TOP', 'Toppings', 8, 0, 5, false, 'Active')
on conflict (id) do nothing;

insert into fb_outlet_types (id, code, name, description, has_tables, has_kds, status) values
  ('OFT1', 'REST', 'Restaurant', 'Full-service dining', 'Yes', 'Yes', 'Active'),
  ('OFT2', 'CAFE', 'Cafe', 'Quick-service cafe', 'Yes', 'Yes', 'Active'),
  ('OFT3', 'BAR', 'Bar', 'Bar service', 'Yes', 'No', 'Active')
on conflict (id) do nothing;

insert into fnb_menu_categories (id, code, name, description, display_order, is_active) values
  ('a1000001-0000-4000-8000-000000000001', 'STAR', 'Starters', 'Appetizers and small plates', 1, true),
  ('a1000001-0000-4000-8000-000000000002', 'MAIN', 'Main Course', 'Curries, grills, and mains', 2, true),
  ('a1000001-0000-4000-8000-000000000003', 'BEV', 'Beverages', 'Hot and cold drinks', 3, true),
  ('a1000001-0000-4000-8000-000000000004', 'DST', 'Desserts', 'Sweets and desserts', 4, true)
on conflict (id) do nothing;

insert into fnb_menu_items (
  id, item_code, name, description, category_id, unit_id, tax_group_id,
  item_type, is_vegetarian, is_active, display_order
) values
  (
    'e3000001-0000-4000-8000-000000000001',
    'IT-BC01',
    'Butter Chicken',
    'Creamy tomato-based curry',
    'a1000001-0000-4000-8000-000000000002',
    'b2000001-0000-4000-8000-000000000003',
    'c2000001-0000-4000-8000-000000000001',
    'FOOD',
    false,
    true,
    1
  ),
  (
    'e3000001-0000-4000-8000-000000000002',
    'IT-PT01',
    'Paneer Tikka',
    'Grilled cottage cheese starter',
    'a1000001-0000-4000-8000-000000000001',
    'b2000001-0000-4000-8000-000000000003',
    'c2000001-0000-4000-8000-000000000001',
    'FOOD',
    true,
    true,
    2
  )
on conflict (id) do nothing;

insert into fb_ingredients (id, code, name, uom, on_hand, reorder, status) values
  ('ING1','CHK','Chicken','kg',48,20,'Active'),
  ('ING2','PNR','Paneer','kg',22,10,'Active'),
  ('ING3','RCE','Basmati Rice','kg',110,40,'Active'),
  ('ING4','OIL','Cooking Oil','ltr',35,15,'Active')
on conflict (id) do nothing;

insert into fb_reservations (id, res_no, outlet_id, guest, phone, time, covers, table_no, status) values
  ('R1','TR-1042','rest-1','Anita Desai','+91 98765 11111','7:30 PM',4,'T-07','Confirmed'),
  ('R2','TR-1043','rest-1','Michael Brown','+91 98765 22222','8:00 PM',2,'T-09','Confirmed'),
  ('R3','TR-1040','rest-1','Priya Patel','+91 98765 33333','1:00 PM',4,'T-04','Seated'),
  ('R4','TR-1038','rest-2','Sarah Chen','+91 98765 44444','7:00 PM',6,'—','Cancelled')
on conflict (id) do nothing;

insert into fb_day_closings (id, outlet_id, business_date, checkpoint, detail, count, status) values
  ('D1','rest-1','24 Jul','Open tables','Active covers must be closed',1,'Pending'),
  ('D2','rest-1','24 Jul','Cashier shifts','All shifts closed',0,'Completed'),
  ('D3','rest-1','24 Jul','Void / comps','Manager approval complete',2,'Completed'),
  ('D4','rest-1','24 Jul','Sales post to FO','Room charge sync',3,'Pending'),
  ('D5','rest-2','24 Jul','Open tables','Active covers must be closed',0,'Completed'),
  ('D6','rest-2','24 Jul','Cashier shifts','All shifts closed',0,'Completed')
on conflict (id) do nothing;

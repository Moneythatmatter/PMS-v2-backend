-- Food & Beverages schema for Hotel PMS
-- Run in Supabase SQL Editor after front-office-schema.sql

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

-- ========== MENU ==========
create table if not exists fb_menu_categories (
  id text primary key,
  code text,
  name text not null,
  item_count int default 0,
  sort_order int default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_menu_items (
  id text primary key,
  code text,
  name text not null,
  category text default '',
  price numeric default 0,
  cost numeric default 0,
  status text default 'Active',
  outlet_id text,
  created_at timestamptz default now()
);

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

create table if not exists fb_combos (
  id text primary key,
  code text,
  name text not null,
  item_count int default 0,
  price numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_pricing_rules (
  id text primary key,
  item text not null,
  outlet_id text,
  base_price numeric default 0,
  outlet_price numeric default 0,
  online_price numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

-- ========== BANQUET ==========
create table if not exists fb_banquet_bookings (
  id text primary key,
  booking_no text not null,
  venue_id text,
  event text default '',
  company text default '',
  date text default '',
  pax int default 0,
  amount numeric default 0,
  status text default 'Confirmed',
  created_at timestamptz default now()
);

create table if not exists fb_banquet_packages (
  id text primary key,
  code text,
  name text not null,
  rate_per_pax numeric default 0,
  courses int default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_banquet_requirements (
  id text primary key,
  booking_no text,
  requirement text not null,
  dept text default '',
  time text default '',
  status text default 'Pending',
  outlet_id text,
  created_at timestamptz default now()
);

create table if not exists fb_banquet_billing (
  id text primary key,
  booking_no text,
  event text default '',
  charges numeric default 0,
  paid numeric default 0,
  balance numeric default 0,
  status text default 'Pending',
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

create table if not exists fb_suppliers (
  id text primary key,
  code text,
  name text not null,
  category text default '',
  phone text default '',
  lead_days int default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_purchase_orders (
  id text primary key,
  po_no text not null,
  supplier text default '',
  items int default 0,
  value numeric default 0,
  eta text default '',
  status text default 'Draft',
  created_at timestamptz default now()
);

create table if not exists fb_grn (
  id text primary key,
  grn_no text not null,
  po_no text default '',
  supplier text default '',
  items int default 0,
  value numeric default 0,
  status text default 'Pending',
  created_at timestamptz default now()
);

create table if not exists fb_stock_movements (
  id text primary key,
  move_no text not null,
  from_location text default '',
  to_location text default '',
  items int default 0,
  value numeric default 0,
  status text default 'Completed',
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

create table if not exists fb_stock_counts (
  id text primary key,
  count_no text,
  store text default '',
  items int default 0,
  variance numeric default 0,
  date text default '',
  status text default 'Draft',
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

-- ========== BAR ==========
create table if not exists fb_drink_categories (
  id text primary key,
  code text,
  name text not null,
  item_count int default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_drinks (
  id text primary key,
  code text,
  name text not null,
  category text default '',
  pour text default '',
  price numeric default 0,
  status text default 'Active',
  outlet_id text,
  created_at timestamptz default now()
);

create table if not exists fb_cocktails (
  id text primary key,
  code text,
  name text not null,
  base_spirit text default '',
  price numeric default 0,
  cost numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_happy_hour (
  id text primary key,
  name text not null,
  time_window text default '',
  discount text default '',
  days text default '',
  status text default 'Active',
  outlet_id text,
  created_at timestamptz default now()
);

create table if not exists fb_bar_stock (
  id text primary key,
  item text not null,
  on_hand numeric default 0,
  unit text default 'btl',
  reorder numeric default 0,
  status text default 'OK',
  outlet_id text,
  created_at timestamptz default now()
);

create table if not exists fb_bottle_tracking (
  id text primary key,
  bottle_id text,
  brand text default '',
  opened text default '',
  pours int default 0,
  remaining_pct numeric default 100,
  status text default 'Open',
  outlet_id text,
  created_at timestamptz default now()
);

-- ========== SETTINGS ==========
create table if not exists fb_taxes (
  id text primary key,
  code text,
  name text not null,
  rate numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_discounts (
  id text primary key,
  code text,
  name text not null,
  type text default '',
  value numeric default 0,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_payment_modes (
  id text primary key,
  code text,
  name text not null,
  status text default 'Active',
  created_at timestamptz default now()
);

create table if not exists fb_order_types (
  id text primary key,
  code text,
  name text not null,
  status text default 'Active',
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
    'fb_reservations','fb_menu_categories','fb_menu_items','fb_modifiers','fb_combos',
    'fb_pricing_rules','fb_banquet_bookings','fb_banquet_packages','fb_banquet_requirements',
    'fb_banquet_billing','fb_ingredients','fb_suppliers','fb_purchase_orders','fb_grn',
    'fb_stock_movements','fb_wastage','fb_stock_counts','fb_stock_adjustments',
    'fb_drink_categories','fb_drinks','fb_cocktails','fb_happy_hour','fb_bar_stock',
    'fb_bottle_tracking','fb_taxes','fb_discounts','fb_payment_modes','fb_order_types',
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
  ('conf-a','Conference Hall A','banquet','Active',0,0,'₹0'),
  ('conf-b','Conference Hall B','banquet','Active',0,0,'₹0'),
  ('lawn','Lawn','banquet','Active',0,0,'₹0'),
  ('pool','Pool Side','banquet','Active',0,0,'₹0'),
  ('rooftop','Roof Top','banquet','Active',0,0,'₹0'),
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

insert into fb_menu_categories (id, code, name, item_count, sort_order, status) values
  ('MC1','STAR','Starters',12,1,'Active'),
  ('MC2','MAIN','Mains',24,2,'Active'),
  ('MC3','BEV','Beverages',18,3,'Active'),
  ('MC4','DST','Desserts',8,4,'Active')
on conflict (id) do nothing;

insert into fb_menu_items (id, code, name, category, price, cost, status) values
  ('MI1','BC01','Butter Chicken','Mains',420,180,'Active'),
  ('MI2','GN01','Garlic Naan','Mains',80,25,'Active'),
  ('MI3','DM01','Dal Makhani','Mains',280,90,'Active'),
  ('MI4','PT01','Paneer Tikka','Starters',320,110,'Active'),
  ('MI5','CB01','Chicken Biryani','Mains',380,150,'Active'),
  ('MI6','CS01','Club Sandwich','Mains',340,120,'Active')
on conflict (id) do nothing;

insert into fb_ingredients (id, code, name, uom, on_hand, reorder, status) values
  ('ING1','CHK','Chicken','kg',48,20,'Active'),
  ('ING2','PNR','Paneer','kg',22,10,'Active'),
  ('ING3','RCE','Basmati Rice','kg',110,40,'Active'),
  ('ING4','OIL','Cooking Oil','ltr',35,15,'Active')
on conflict (id) do nothing;

insert into fb_suppliers (id, code, name, category, phone, lead_days, status) values
  ('SUP1','VF01','Fresh Farms','Vegetables','+91 90000 11111',1,'Active'),
  ('SUP2','MT01','Metro Meats','Meat','+91 90000 22222',2,'Active'),
  ('SUP3','BV01','Beverage Hub','Beverages','+91 90000 33333',3,'Active')
on conflict (id) do nothing;

insert into fb_taxes (id, code, name, rate, status) values
  ('TX1','CGST','CGST',2.5,'Active'),
  ('TX2','SGST','SGST',2.5,'Active'),
  ('TX3','SERV','Service Charge',5,'Active')
on conflict (id) do nothing;

insert into fb_payment_modes (id, code, name, status) values
  ('PM1','CASH','Cash','Active'),
  ('PM2','CARD','Card','Active'),
  ('PM3','UPI','UPI','Active'),
  ('PM4','ROOM','Room Charge','Active')
on conflict (id) do nothing;

insert into fb_order_types (id, code, name, status) values
  ('OT1','DI','Dine In','Active'),
  ('OT2','TA','Takeaway','Active'),
  ('OT3','RS','Room Service','Active'),
  ('OT4','OL','Online','Active')
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

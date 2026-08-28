-- F&B POS v2: sessions, normalized items, KOT, bills
-- Run in Supabase. Does NOT drop legacy columns (fb_orders.lines, fb_live_tables guest fields, etc.)

-- ========== TABLE SESSIONS (dine-in visits) ==========
create table if not exists fb_table_sessions (
  id text primary key,
  live_table_id text not null references fb_live_tables(id) on delete cascade,
  outlet_id text not null references fb_outlets(id) on delete cascade,
  reservation_id text references fb_reservations(id) on delete set null,
  guest_id text,
  guest_name text not null default '',
  guest_no text,
  pax int not null default 2,
  server text not null default '',
  status text not null default 'OPEN',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_fb_table_sessions_table on fb_table_sessions(live_table_id);
create index if not exists idx_fb_table_sessions_outlet on fb_table_sessions(outlet_id);
create index if not exists idx_fb_table_sessions_open on fb_table_sessions(live_table_id, status)
  where status = 'OPEN';

-- ========== ORDERS — lifecycle column (keep legacy status for kitchen during migration) ==========
alter table fb_orders add column if not exists session_id text references fb_table_sessions(id) on delete set null;
alter table fb_orders add column if not exists lifecycle_status text not null default 'OPEN';

create index if not exists idx_fb_orders_session on fb_orders(session_id);
create index if not exists idx_fb_orders_lifecycle on fb_orders(lifecycle_status);

-- ========== ORDER ITEMS ==========
create table if not exists fb_order_items (
  id text primary key,
  order_id text not null references fb_orders(id) on delete cascade,
  menu_item_id text,
  name text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  note text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create index if not exists idx_fb_order_items_order on fb_order_items(order_id);

-- ========== KOT TICKETS ==========
create table if not exists fb_kot_tickets (
  id text primary key,
  order_id text not null references fb_orders(id) on delete cascade,
  kot_number text not null,
  status text not null default 'PENDING',
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fb_kot_tickets_order on fb_kot_tickets(order_id);
create unique index if not exists idx_fb_kot_tickets_number on fb_kot_tickets(kot_number);

-- ========== KOT ITEMS ==========
create table if not exists fb_kot_items (
  id text primary key,
  kot_id text not null references fb_kot_tickets(id) on delete cascade,
  order_item_id text not null references fb_order_items(id) on delete cascade,
  quantity numeric not null default 1 check (quantity > 0),
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

create index if not exists idx_fb_kot_items_kot on fb_kot_items(kot_id);
create index if not exists idx_fb_kot_items_order_item on fb_kot_items(order_item_id);

-- ========== BILLS ==========
create table if not exists fb_bills (
  id text primary key,
  order_id text not null references fb_orders(id) on delete cascade,
  bill_no text not null,
  status text not null default 'OPEN',
  payment_status text not null default 'UNPAID',
  bill_printed_at timestamptz,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fb_bills_order on fb_bills(order_id);
create unique index if not exists idx_fb_bills_bill_no on fb_bills(bill_no);

-- ========== LIVE TABLES — physical + housekeeping ==========
alter table fb_live_tables add column if not exists housekeeping text not null default 'CLEAN';

comment on column fb_live_tables.housekeeping is 'CLEAN | DIRTY — post-payment table reset';
comment on column fb_orders.lifecycle_status is 'OPEN | CLOSED | CANCELLED';
comment on column fb_kot_tickets.status is 'PENDING | PREPARING | READY | SERVED | CANCELLED';
comment on column fb_bills.payment_status is 'UNPAID | PARTIALLY_PAID | PAID';

-- ========== RLS (match food-beverages-schema.sql anon_all pattern) ==========
do $$
declare
  t text;
begin
  foreach t in array array[
    'fb_table_sessions',
    'fb_order_items',
    'fb_kot_tickets',
    'fb_kot_items',
    'fb_bills'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%s" on %I', t, t);
    execute format(
      'create policy "anon_all_%s" on %I for all to anon using (true) with check (true)',
      t, t
    );
    execute format('drop policy if exists "authenticated_all_%s" on %I', t, t);
    execute format(
      'create policy "authenticated_all_%s" on %I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

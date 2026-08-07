-- Patch: add table master fields + reservation seeds
-- Run in Supabase SQL Editor if F&B schema already applied
-- Fixes: Could not find the 'shape' column of 'fb_live_tables' in the schema cache

alter table fb_live_tables add column if not exists shape text default 'Square';
alter table fb_live_tables add column if not exists qr text default 'Linked';

update fb_live_tables set shape = coalesce(shape, 'Square'), qr = coalesce(qr, 'Linked') where true;

-- Outlet booking availability (separate from Active/Inactive operational status)
alter table fb_outlets add column if not exists booking_status text default 'Available';
update fb_outlets
set booking_status = coalesce(nullif(booking_status, ''), 'Available')
where true;

-- Close Event / banquet billing extras
alter table fb_banquet_billing add column if not exists outlet_id text;
alter table fb_banquet_billing add column if not exists venue text default '';

-- Flexible records for recipes / extra settings pages
create table if not exists fb_module_records (
  id text primary key,
  module_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_fb_module_records_key on fb_module_records(module_key);
alter table fb_module_records enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'fb_module_records' and policyname = 'anon_all_fb_module_records'
  ) then
    create policy anon_all_fb_module_records on fb_module_records for all using (true) with check (true);
  end if;
end $$;

-- Refresh PostgREST schema cache so inserts/updates see the new columns
notify pgrst, 'reload schema';

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

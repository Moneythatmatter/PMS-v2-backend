-- Seed missing ops data for Live Tables / Reservations / Day Close pages.
-- Run in Supabase SQL Editor if these pages show empty (even on Restaurant #1).

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

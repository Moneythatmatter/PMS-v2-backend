-- Walk-in / in-house guest link, party size, and room-service booking ref on F&B orders
alter table fb_orders add column if not exists guest_id text;
alter table fb_orders add column if not exists guest_no text;
alter table fb_orders add column if not exists reservation_id text;
alter table fb_orders add column if not exists pax int;

create index if not exists idx_fb_orders_guest_id on fb_orders(guest_id);
create index if not exists idx_fb_orders_reservation_id on fb_orders(reservation_id);

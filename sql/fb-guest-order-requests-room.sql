-- Room QR food orders also go through Guest Order Requests for staff review.
-- Adds a source (Table / Room) and room + stay details; table columns become optional.

alter table public.fb_guest_order_requests
  add column if not exists source text not null default 'Table',
  add column if not exists room_id text,
  add column if not exists room_no text,
  add column if not exists reservation_id text,
  add column if not exists guest_id text,
  add column if not exists guest_no text;

alter table public.fb_guest_order_requests alter column live_table_id drop not null;
alter table public.fb_guest_order_requests alter column table_no drop not null;

alter table public.fb_guest_order_requests drop constraint if exists fb_guest_order_requests_source_check;
alter table public.fb_guest_order_requests
  add constraint fb_guest_order_requests_source_check check (source in ('Table', 'Room'));

alter table public.fb_guest_order_requests drop constraint if exists fb_guest_order_requests_target_check;
alter table public.fb_guest_order_requests
  add constraint fb_guest_order_requests_target_check check (
    (source = 'Table' and live_table_id is not null) or (source = 'Room' and room_id is not null)
  );

create index if not exists fb_guest_order_requests_room_idx
  on public.fb_guest_order_requests (room_id, created_at desc);
create index if not exists fb_guest_order_requests_reservation_idx
  on public.fb_guest_order_requests (reservation_id, created_at desc);

notify pgrst, 'reload schema';

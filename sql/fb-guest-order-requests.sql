-- Guest order requests placed by scanning a table QR. Staff review each request
-- and convert it into a real F&B order (fb_orders) from the Guest Order Requests page.

create table if not exists public.fb_guest_order_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null,
  outlet_id text,
  outlet_name text,
  live_table_id text not null,
  table_no text not null,
  guest_name text,
  guest_phone text,
  pax integer,
  lines jsonb not null default '[]'::jsonb,
  instructions text,
  subtotal numeric(12, 2) not null default 0,
  status text not null default 'Pending'
    check (status in ('Pending', 'Accepted', 'Rejected', 'Cancelled')),
  order_id text,
  order_no text,
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_guest_order_requests_status_idx
  on public.fb_guest_order_requests (status, created_at desc);
create index if not exists fb_guest_order_requests_table_idx
  on public.fb_guest_order_requests (live_table_id, created_at desc);

alter table public.fb_guest_order_requests enable row level security;

drop policy if exists fb_guest_order_requests_all on public.fb_guest_order_requests;
create policy fb_guest_order_requests_all on public.fb_guest_order_requests
  for all using (true) with check (true);

notify pgrst, 'reload schema';

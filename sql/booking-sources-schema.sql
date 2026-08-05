-- Booking Sources master (run once in Supabase SQL Editor)

create table if not exists booking_sources (
  id text primary key,
  code text not null unique,
  name text not null,
  description text default '',
  status text not null default 'Active',
  created_at timestamptz default now()
);

alter table booking_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'booking_sources'
      and policyname = 'anon_all_booking_sources'
  ) then
    create policy "anon_all_booking_sources"
      on public.booking_sources
      for all to anon
      using (true)
      with check (true);
  end if;
end $$;

insert into booking_sources (id, code, name, description, status) values
  ('BS-01', 'WALKIN', 'Walk-in', 'Guest arrived at front desk without prior booking', 'Active'),
  ('BS-02', 'WEB', 'Website', 'Direct booking via hotel website', 'Active'),
  ('BS-03', 'BCOM', 'Booking.com', 'OTA — Booking.com', 'Active'),
  ('BS-04', 'AGODA', 'Agoda', 'OTA — Agoda', 'Active'),
  ('BS-05', 'MMT', 'MakeMyTrip', 'OTA — MakeMyTrip', 'Active'),
  ('BS-06', 'TA', 'Travel Agent', 'Booked through travel agent', 'Active'),
  ('BS-07', 'CORP', 'Corporate', 'Corporate / company booking', 'Active')
on conflict (id) do nothing;

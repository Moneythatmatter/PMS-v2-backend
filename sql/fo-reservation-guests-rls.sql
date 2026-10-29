-- Fix: "new row violates row-level security policy for table reservation_guests" on check-in.
-- The API writes this table when linking the primary guest + companions to a booking.
-- Same pattern as guest_documents / housekeeping tables. Run once in Supabase SQL Editor.

alter table public.reservation_guests enable row level security;

drop policy if exists "anon_all_reservation_guests" on public.reservation_guests;
create policy "anon_all_reservation_guests" on public.reservation_guests
  for all to anon using (true) with check (true);

drop policy if exists "authenticated_all_reservation_guests" on public.reservation_guests;
create policy "authenticated_all_reservation_guests" on public.reservation_guests
  for all to authenticated using (true) with check (true);

-- Patch: guests — remove stored total_stays (computed from reservations at API layer)
-- Run once in Supabase SQL Editor.

alter table public.guests drop column if exists total_stays;

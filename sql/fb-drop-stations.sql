-- Remove F&B kitchen station masters (not used in current menu flow).
-- Run once in Supabase SQL Editor.

drop table if exists public.fnb_stations cascade;
drop table if exists public.fb_stations cascade;

notify pgrst, 'schema cache';

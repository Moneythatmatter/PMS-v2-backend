-- Remove F&B combo meals (not used in current menu flow).
-- Run once in Supabase SQL Editor.

drop table if exists public.fb_combos cascade;

notify pgrst, 'schema cache';

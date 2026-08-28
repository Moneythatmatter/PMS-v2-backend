-- Remove unit, station, and item type from fnb_menu_items (UI no longer uses them).
-- Run once in Supabase SQL Editor.

drop index if exists public.idx_fnb_menu_items_type;

alter table public.fnb_menu_items drop column if exists unit_id;
alter table public.fnb_menu_items drop column if exists station_id;
alter table public.fnb_menu_items drop column if exists item_type;

drop type if exists public.fnb_item_type;

notify pgrst, 'schema cache';

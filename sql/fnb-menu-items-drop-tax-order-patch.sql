-- Remove tax_group_id and display_order from fnb_menu_items (flat item form).
-- Run once in Supabase SQL Editor on existing databases.

drop index if exists idx_fnb_menu_items_display_order;

alter table public.fnb_menu_items
  drop column if exists tax_group_id,
  drop column if exists display_order;

notify pgrst, 'schema cache';

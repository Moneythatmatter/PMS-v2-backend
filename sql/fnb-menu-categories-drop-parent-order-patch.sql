-- Flatten fnb_menu_categories: remove hierarchy (parent_id) and display_order.
-- Run once in Supabase SQL Editor on existing databases.

drop index if exists idx_fnb_menu_categories_parent;
drop index if exists idx_fnb_menu_categories_display_order;

alter table public.fnb_menu_categories
  drop column if exists parent_id,
  drop column if exists display_order;

notify pgrst, 'schema cache';

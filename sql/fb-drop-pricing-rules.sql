-- Remove F&B menu pricing rules (price lives on fnb_menu_items.price).
-- Run once in Supabase SQL Editor.

drop table if exists public.fb_pricing_rules cascade;

notify pgrst, 'schema cache';

-- Remove F&B Bar module tables (drinks, cocktails, stock, bottle tracking).
-- Run once in Supabase SQL Editor.

drop table if exists public.fb_bottle_tracking cascade;
drop table if exists public.fb_bar_stock cascade;
drop table if exists public.fb_happy_hour cascade;
drop table if exists public.fb_cocktails cascade;
drop table if exists public.fb_drinks cascade;
drop table if exists public.fb_drink_categories cascade;

notify pgrst, 'schema cache';

-- Drop F&B suppliers and purchase orders (procurement lives in Purchase & Stores module).
-- Run once in Supabase SQL Editor.

drop table if exists public.fb_purchase_orders cascade;
drop table if exists public.fb_suppliers cascade;

notify pgrst, 'schema cache';

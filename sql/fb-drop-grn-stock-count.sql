-- Drop F&B GRN, stock movements, and stock counts (procurement/stock lives in Purchase & Stores).
-- Run once in Supabase SQL Editor.

drop table if exists public.fb_stock_counts cascade;
drop table if exists public.fb_stock_movements cascade;
drop table if exists public.fb_grn cascade;

notify pgrst, 'schema cache';

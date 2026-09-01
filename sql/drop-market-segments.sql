-- Patch: remove Front Office market_segments master
-- Run once in Supabase SQL Editor after backups if needed.

drop table if exists public.market_segments cascade;

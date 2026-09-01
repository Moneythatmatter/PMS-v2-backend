-- Room types master — remove occupancy & total room count (tracked on rooms master instead)
-- Run once in Supabase SQL Editor after front-office-schema / multi-property-schema.

alter table public.room_types drop column if exists max_occupancy;
alter table public.room_types drop column if exists max_adults;
alter table public.room_types drop column if exists max_children;
alter table public.room_types drop column if exists total_rooms;

notify pgrst, 'schema cache';

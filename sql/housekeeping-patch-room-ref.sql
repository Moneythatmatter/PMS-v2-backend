-- Patch: hk_rooms — room_ref_id (FO rooms.room_no) + UUID primary keys
-- Run in Supabase SQL Editor (requires front-office rooms table)

create extension if not exists pgcrypto;

alter table hk_rooms add column if not exists room_ref_id text;

-- Backfill FO room reference from room_no
update hk_rooms
set room_ref_id = coalesce(nullif(room_ref_id, ''), room_no)
where room_ref_id is null or room_ref_id = '';

-- Replace legacy ids (101, RM-101, etc.) with UUID v4
update hk_rooms
set id = gen_random_uuid()::text
where id is null
   or id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Link to Front Office rooms master
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'rooms'
  ) then
    alter table hk_rooms drop constraint if exists hk_rooms_room_ref_id_fkey;
    alter table hk_rooms
      add constraint hk_rooms_room_ref_id_fkey
      foreign key (room_ref_id) references rooms(room_no)
      not valid;
    alter table hk_rooms validate constraint hk_rooms_room_ref_id_fkey;
  end if;
exception
  when others then null;
end $$;

notify pgrst, 'reload schema';

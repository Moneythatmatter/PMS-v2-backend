-- HK room status: use CLEAN for "cleaning done, awaiting inspection"
-- Migrate legacy rows that used INSPECTING + last_cleaned_at as a proxy for Clean.

update public.hk_rooms
set status = 'CLEAN'::public.hk_room_status,
    updated_at = now()
where status = 'INSPECTING'::public.hk_room_status
  and last_cleaned_at is not null;

notify pgrst, 'reload schema';

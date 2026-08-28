-- Remove Banquet from Food & Beverages (run in Supabase SQL editor)

drop table if exists fb_banquet_billing cascade;
drop table if exists fb_banquet_requirements cascade;
drop table if exists fb_banquet_packages cascade;
drop table if exists fb_banquet_bookings cascade;

delete from fb_outlets where lower(type) = 'banquet';
delete from fb_outlet_types where lower(code) = 'bnq' or lower(name) = 'banquet';

notify pgrst, 'schema cache';

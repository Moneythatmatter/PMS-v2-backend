-- Remove Housekeeping luggage module.
-- Front Office luggage (public.luggage_items) is not affected.

drop table if exists public.hk_luggage_jobs cascade;

notify pgrst, 'reload schema';

-- STEP 1 — Run this ENTIRE file first. Wait for "Success", then run housekeeping-tasks-v2.sql
-- Tip: In Supabase SQL Editor, run this alone (do not combine with v2 in one tab).

alter type public.hk_task_status add value if not exists 'PENDING_INSPECTION';
alter type public.hk_task_type add value if not exists 'GUEST_REQUEST';
alter type public.hk_task_type add value if not exists 'OTHER';

-- Verify (should list GUEST_REQUEST, OTHER, PENDING_INSPECTION among others):
-- select t.typname, e.enumlabel
-- from pg_type t
-- join pg_enum e on e.enumtypid = t.oid
-- join pg_namespace n on n.oid = t.typnamespace
-- where n.nspname = 'public' and t.typname in ('hk_task_type', 'hk_task_status')
-- order by t.typname, e.enumsortorder;

notify pgrst, 'schema cache';

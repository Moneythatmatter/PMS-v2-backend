-- Add PENDING_INSPECTION to hk_task_status (required for "Mark Complete" on cleaning tasks).
-- Run in Supabase SQL Editor if Mark Complete fails with:
--   invalid input value for enum hk_task_status: "PENDING_INSPECTION"

alter type public.hk_task_status add value if not exists 'PENDING_INSPECTION';

notify pgrst, 'reload schema';

-- Patch: GRN — remove receiving dock / bay (no longer captured on the GRN form)
-- Run once in Supabase SQL Editor.

alter table public.ps_grns drop column if exists receiving_dock;

notify pgrst, 'reload schema';

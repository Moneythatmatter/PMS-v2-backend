-- =============================================================================
-- Accounts — per-line narration on voucher lines. Safe to re-run.
-- Lines without their own narration fall back to the voucher's common narration.
-- =============================================================================

alter table public.acc_voucher_lines
  add column if not exists narration text not null default '';

notify pgrst, 'reload schema';

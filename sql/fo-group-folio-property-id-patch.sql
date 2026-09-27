-- Patch: set property_id on group/child folios + heal ensure_* RPCs
-- Cause: master folio existed but API filtered it out (property_id IS NULL).
-- Safe to re-run.

-- Backfill existing rows
update public.folios f
set property_id = g.property_id
from public.fo_groups g
where f.group_id = g.id
  and f.booking_id is null
  and f.property_id is null
  and g.property_id is not null;

update public.folios f
set property_id = r.property_id
from public.reservations r
where f.booking_id = r.id
  and f.property_id is null
  and r.property_id is not null;

-- Re-apply ensure_folio_for_group / ensure_folio_for_booking from
-- fo-group-booking-p0-p1.sql (property_id on insert + heal on reopen).
-- Prefer re-running the full P0–P1 script, or copy the two function
-- definitions from that file after this patch.

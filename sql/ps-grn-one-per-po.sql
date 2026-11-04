-- One GRN per purchase order (per property).
-- The API already refuses a second GRN; this index makes the database enforce it too.
-- If a PO already has more than one GRN, the index is skipped and the duplicates are listed —
-- delete the extra GRN(s) and run this file again.

do $$
declare
  dupes text;
begin
  select string_agg(format('%s → %s', po_number, grns), E'\n')
    into dupes
  from (
    select po_number, string_agg(grn_number || ' (' || status || ')', ', ' order by created_at) as grns
    from ps_grns
    where coalesce(po_number, '') <> ''
    group by property_id, po_number
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise notice E'Index NOT created. These POs have more than one GRN:\n%', dupes;
  else
    create unique index if not exists ps_grns_one_per_po
      on ps_grns (property_id, po_number)
      where coalesce(po_number, '') <> '';
    raise notice 'ps_grns_one_per_po created.';
  end if;
end $$;

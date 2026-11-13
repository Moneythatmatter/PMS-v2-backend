-- Stamp property_id / tenant_id on F&B payments missing them.
-- Without these, settle can record cash but bill sync never sees it (stays UNPAID / Printed).
-- Safe to re-run.

update public.transactions t
set
  property_id = coalesce(t.property_id, out.property_id),
  tenant_id = coalesce(t.tenant_id, out.tenant_id, p.tenant_id)
from public.fb_bills b
join public.fb_orders o on o.id = b.order_id
left join public.fb_outlets out on out.id = o.outlet_id
left join public.properties p on p.id = out.property_id
where t.source_module = 'FNB'
  and t.source_id::text = b.id::text
  and (t.property_id is null or t.tenant_id is null);

update public.transactions t
set tenant_id = p.tenant_id
from public.properties p
where t.property_id = p.id
  and t.tenant_id is null
  and p.tenant_id is not null;

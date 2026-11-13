-- Grant Tenant Admins full module access on every property in their home tenant.
-- Use when a property was created via demo-property-seed.sql (or similar) and
-- Front Office / other modules say "You do not have access to this module".
-- Safe to re-run.

insert into public.user_permissions (id, user_id, property_id, module_key, permission)
select gen_random_uuid()::text, u.id, p.id, m.module_key, 'admin'
from public.users u
join public.properties p
  on p.tenant_id = u.tenant_id
 and p.status = 'Active'
cross join (values
  ('dashboard'),
  ('front_office'),
  ('food_beverages'),
  ('housekeeping'),
  ('purchase_stores'),
  ('human_resources'),
  ('accounts'),
  ('sales_marketing'),
  ('maintenance'),
  ('workspace.properties'),
  ('workspace.dashboard'),
  ('workspace.reports'),
  ('workspace.user_management'),
  ('workspace.roles')
) m(module_key)
where coalesce(u.is_super_admin, false) = false
  and lower(trim(u.role)) in ('admin', 'administrator')
  and u.tenant_id is not null
  and not exists (
    select 1 from public.user_permissions up
    where up.user_id = u.id
      and up.property_id = p.id
      and up.module_key = m.module_key
  );
